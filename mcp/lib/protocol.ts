// Reading one line into a JSON-RPC request, and the checks that decide whether
// it is a request at all. The rules here mirror the Go server the Node one
// replaces, so a client that worked against one works against the other.

import type { RpcError } from "./limits.ts";
import { defaultProtocolVersion, supportedProtocolVersions } from "./limits.ts";

// One parsed request, plus whether the id member was present at all. JSON.parse
// cannot tell a notification (no id member) from a request whose id is null, so
// the presence is carried separately.
export interface ParsedRequest {
  jsonrpc: unknown;
  hasId: boolean;
  id: unknown;
  method: string;
  params: unknown;
}

export type ParseOutcome =
  | { ok: true; request: ParsedRequest }
  | { ok: false };

const EMPTY_REQUEST: ParsedRequest = {
  jsonrpc: undefined,
  hasId: false,
  id: undefined,
  method: "",
  params: undefined,
};

// parseRequest mirrors a decode into the Go request struct. A line that is not
// a JSON object at all is a parse error, a null line is a request with every
// member missing, and a method that is not a string fails the whole decode. The
// difference matters: an array is a parse error, while a null line is Invalid
// Request, which is the same answer the Go server gave.
export function parseRequest(line: string): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false };
  }
  if (parsed === null) {
    return { ok: true, request: { ...EMPTY_REQUEST } };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false };
  }
  const object = parsed as Record<string, unknown>;
  let method = "";
  if (Object.hasOwn(object, "method") && object.method !== null) {
    if (typeof object.method !== "string") {
      return { ok: false };
    }
    method = object.method;
  }
  return {
    ok: true,
    request: {
      jsonrpc: Object.hasOwn(object, "jsonrpc") ? object.jsonrpc : undefined,
      hasId: Object.hasOwn(object, "id"),
      id: object.id,
      method,
      params: Object.hasOwn(object, "params") ? object.params : undefined,
    },
  };
}

// validateEnvelope checks the two parts of a JSON-RPC 2.0 message that make it a
// request at all: the version and the id. A message that fails either is
// answered Invalid Request and no method runs.
export function validateEnvelope(request: ParsedRequest): RpcError | null {
  if (request.jsonrpc === undefined) {
    return {
      code: -32600,
      message:
        'Invalid Request. The jsonrpc member is missing. Every JSON-RPC 2.0 message must carry "jsonrpc":"2.0".',
    };
  }
  if (typeof request.jsonrpc !== "string") {
    return {
      code: -32600,
      message:
        'Invalid Request. The jsonrpc member must be the string "2.0", not a number, an array or an object.',
    };
  }
  if (request.jsonrpc !== "2.0") {
    return {
      code: -32600,
      message: `Invalid Request. The jsonrpc member must be "2.0". This server speaks JSON-RPC ${request.jsonrpc}.`,
    };
  }
  if (!request.hasId) {
    return null;
  }
  if (!validID(request.id)) {
    return {
      code: -32600,
      message: `Invalid Request. The id member must be a string, a number or null. Got ${jsonTypeOf(request.id)}. The id is echoed back unchanged on every answer, so a wrong one is a mistake worth naming rather than passing along.`,
    };
  }
  return null;
}

// validID reports whether an id is one JSON-RPC 2.0 allows: a string, a number,
// or null. An object or an array is refused, because echoing one back as the id
// of an answer is not something the spec describes.
export function validID(id: unknown): boolean {
  if (typeof id === "string" || typeof id === "number") {
    return true;
  }
  return id === null;
}

// jsonTypeOf names the JSON type of a value, for a message that says what was
// wrong with the id or an argument.
export function jsonTypeOf(value: unknown): string {
  if (value === undefined) {
    return "a value that is not valid JSON";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return "object";
}

// isEmptyValue reports a field that is absent, null, or a blank string. A blank
// scan id is no more usable than a missing one, and it says so the same way.
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return false;
}

// negotiateProtocol answers the version the client asked for when this server
// serves it, and the default otherwise. It mirrors the hosted surface so both
// accept the same clients. A params that is not an object is answered with the
// default, which is what a failed decode produced before.
export function negotiateProtocol(params: unknown): string {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return defaultProtocolVersion;
  }
  const asked = (params as Record<string, unknown>).protocolVersion;
  if (typeof asked === "string" && supportedProtocolVersions.includes(asked)) {
    return asked;
  }
  return defaultProtocolVersion;
}
