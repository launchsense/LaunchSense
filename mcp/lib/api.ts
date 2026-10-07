// One call to the LaunchSense API. The body is capped so a report that is too
// large comes back as a partial answer rather than being read whole, and the
// call is bounded so an endpoint that accepts and never answers cannot hold a
// tool call open for ever.

import { apiTimeoutMs, maxReportBytes } from "./limits.ts";

export async function postJSON(
  apiURL: string,
  path: string,
  body: unknown,
): Promise<string> {
  const signal = AbortSignal.timeout(apiTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiURL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw describeFailure(error, signal);
  }

  const data = await readCapped(response, signal);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LaunchSense API error ${response.status}`);
  }
  if (data.length > maxReportBytes) {
    throw new Error(
      `the report body is over ${maxReportBytes} bytes and was cut off, so this is a partial answer and not a report. Ask again for a smaller scan, or read the report on the website.`,
    );
  }
  return data.toString("utf8");
}

// readCapped reads the body until it ends or the cap is crossed. It stops one
// byte past the cap, so a body at the cap is whole and a body that crosses it is
// known to be clipped rather than assumed complete.
async function readCapped(
  response: Response,
  signal: AbortSignal,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }
  const parts: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      parts.push(chunk);
      total += chunk.length;
      if (total > maxReportBytes) {
        break;
      }
    }
  } catch (error) {
    throw describeFailure(error, signal);
  }
  return Buffer.concat(parts);
}

// describeFailure names a timeout as a timeout, and anything else as a call
// that could not be made. The body bytes are never part of the message, so a
// half-read report can never be handed over as if it were whole.
function describeFailure(error: unknown, signal: AbortSignal): Error {
  const name = error instanceof Error ? error.name : "";
  if (signal.aborted || name === "TimeoutError" || name === "AbortError") {
    return new Error(
      `the LaunchSense API did not answer within ${apiTimeoutMs} ms, so this is a timeout and there is no report here.`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`could not reach the LaunchSense API: ${message}`);
}
