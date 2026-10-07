// The local LaunchSense MCP server, over stdio. It reads one JSON-RPC message
// per line and writes one per line.
//
// Each message is handled on its own, so a slow tool call does not hold up the
// messages behind it: a ping during a ten minute local review still answers, and
// a client that uses ping as a liveness probe does not conclude the process is
// dead. The lifecycle and envelope checks, by contrast, run in arrival order, so
// a client that wrote initialize and its next request in one write has both
// admitted in that order. Answers are not in request order, which is normal for
// a concurrent server: MCP matches an answer to its request by id.
//
// The runtime is wired here from the small modules in lib/, so each piece can be
// read and tested on its own.

import { LineReader, buildResult } from "./lib/framing.ts";
import {
  defaultApiUrl,
  defaultProtocolVersion,
  maxMessageBytes,
} from "./lib/limits.ts";
import type { RpcError } from "./lib/limits.ts";
import {
  negotiateProtocol,
  parseRequest,
  validateEnvelope,
} from "./lib/protocol.ts";
import type { ParsedRequest } from "./lib/protocol.ts";
import { toolDef, toolDefs, validateArgs } from "./lib/tools.ts";
import { callTool } from "./lib/actions.ts";
import type { ToolRuntime } from "./lib/actions.ts";
import { localAccount } from "./lib/github.ts";
import { runNodeReview } from "./lib/review.ts";

interface SessionState {
  initialized: boolean;
  protocol: string;
}

const session: SessionState = {
  initialized: false,
  protocol: defaultProtocolVersion,
};

const apiURL = (process.env.LAUNCHSENSE_API_URL ?? defaultApiUrl).replace(
  /\/+$/,
  "",
);

const runtime: ToolRuntime = {
  apiURL,
  review: runNodeReview,
  account: localAccount,
};

const pending = new Set<Promise<void>>();

// log writes one line to stderr. stdout carries protocol only, so a client
// reading stdout never sees a log line.
function log(message: string): void {
  process.stderr.write(`launchsense-mcp: ${message}\n`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// answer writes one JSON-RPC message as a single string, so two answers can
// never interleave into one broken line.
function answer(id: unknown, result: unknown, rpcError: RpcError | null): void {
  process.stdout.write(buildResult(id, result, rpcError));
}

function toolText(text: string, isError: boolean): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError };
}

// begin runs the envelope and lifecycle checks and returns the error to answer
// with, or null to run the message. It changes the session state as a side
// effect: the one initialize a session gets is accepted here, before its handler
// runs, so a client that wrote initialize and its next request in one write has
// both admitted in that order.
function begin(request: ParsedRequest): RpcError | null {
  const envelopeError = validateEnvelope(request);
  if (envelopeError) {
    return envelopeError;
  }
  if (request.method === "initialize") {
    if (session.initialized) {
      return {
        code: -32600,
        message:
          "Already initialized. This server answers one initialize per session, because the tools and capabilities after it are the same every time. Start a new session, that is a new process, to negotiate again.",
      };
    }
    session.initialized = true;
    session.protocol = negotiateProtocol(request.params);
    return null;
  }
  if (request.method === "ping") {
    // ping is how a client asks whether the process is alive, so it answers
    // before the handshake and after it.
    return null;
  }
  if (!session.initialized) {
    return {
      code: -32002,
      message:
        "Server not initialized. Send initialize first. ping is the only method that answers before it.",
    };
  }
  return null;
}

interface Outcome {
  result?: unknown;
  error?: RpcError;
}

async function handle(request: ParsedRequest): Promise<Outcome> {
  switch (request.method) {
    case "initialize":
      return {
        result: {
          protocolVersion: session.protocol,
          capabilities: { tools: {} },
          serverInfo: { name: "launchsense", version: "0.1.0" },
        },
      };
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: toolDefs() } };
    case "tools/call":
      return await handleToolCall(request.params);
    default:
      return { error: { code: -32601, message: "Method not found." } };
  }
}

async function handleToolCall(params: unknown): Promise<Outcome> {
  // A null or absent params used to answer "Unknown tool: " with a blank name.
  // That named a problem that does not exist and sent the caller looking for a
  // typo, so each shape now says what is actually wrong.
  let call: { name: string; args: unknown };
  if (params === undefined) {
    return { error: { code: -32602, message: "Invalid tool call." } };
  } else if (params === null) {
    call = { name: "", args: undefined };
  } else if (typeof params === "object" && !Array.isArray(params)) {
    const object = params as Record<string, unknown>;
    if (
      Object.hasOwn(object, "name") &&
      object.name !== null &&
      typeof object.name !== "string"
    ) {
      return { error: { code: -32602, message: "Invalid tool call." } };
    }
    call = {
      name: typeof object.name === "string" ? object.name : "",
      args: object.arguments,
    };
  } else {
    return { error: { code: -32602, message: "Invalid tool call." } };
  }

  if (call.name === "") {
    return {
      error: {
        code: -32602,
        message:
          "Invalid tool call: the params member must be a JSON object with a name field.",
      },
    };
  }

  const def = toolDef(call.name);
  if (!def) {
    // isError means a tool ran and failed. A name this server does not have is a
    // protocol error, and the spec's own example is -32602.
    return { error: { code: -32602, message: `Unknown tool: ${call.name}` } };
  }

  const argumentError = validateArgs(def.inputSchema, call.args);
  if (argumentError) {
    return {
      error: {
        code: -32602,
        message: `Invalid arguments for ${call.name}: ${argumentError}`,
      },
    };
  }

  const args =
    call.args !== null && typeof call.args === "object" && !Array.isArray(call.args)
      ? (call.args as Record<string, unknown>)
      : {};
  try {
    const text = await callTool(call.name, args, runtime);
    return { result: toolText(text, false) };
  } catch (error) {
    return { result: toolText(describeError(error), true) };
  }
}

function dispatch(request: ParsedRequest, notification: boolean): void {
  const task = (async () => {
    const outcome = await handle(request);
    if (notification) {
      return;
    }
    answer(request.id, outcome.result, outcome.error ?? null);
  })().catch((error) => {
    log(`answer not written: ${describeError(error)}`);
  });
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

const reader = new LineReader((line, oversize) => {
  if (oversize) {
    log(`message over the ${maxMessageBytes} byte limit was refused`);
    answer(undefined, undefined, {
      code: -32600,
      message: `Message too large. The limit is ${maxMessageBytes} bytes (4 MiB) and nothing was run.`,
    });
    return;
  }
  if (line.trim() === "") {
    return;
  }
  const parsed = parseRequest(line);
  if (!parsed.ok) {
    log("parse error: the line was not one JSON message");
    answer(undefined, undefined, {
      code: -32700,
      message:
        "Parse error. The line was not one JSON message, so nothing was run.",
    });
    return;
  }
  const request = parsed.request;
  // A message with no id member at all is a notification: it is run, and it is
  // never answered. An id that is present and null is a request, answered with
  // id null, which is what JSON-RPC 2.0 says about a null id.
  const notification = !request.hasId;
  const refusal = begin(request);
  if (refusal) {
    if (notification) {
      log(`${request.method} was not run: ${refusal.message}`);
      return;
    }
    answer(request.id, undefined, refusal);
    return;
  }
  dispatch(request, notification);
});

process.stdin.on("data", (chunk: Buffer) => {
  reader.push(chunk);
});

// When stdin closes the session is over. The final line is reported, then the
// answers already in flight are awaited before the process ends, so a client
// that wrote a request and closed its pipe straight after still gets its answer.
process.stdin.on("end", () => {
  reader.end();
  const inFlight = [...pending];
  if (inFlight.length === 0) {
    return;
  }
  void Promise.allSettled(inFlight);
});
