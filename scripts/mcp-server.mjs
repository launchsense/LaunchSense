#!/usr/bin/env node
// Read-only MCP-style adapter for LaunchSense. It calls the public LaunchSense
// API only. It never receives a GitHub token, a private key, or repo content.
// A real MCP host can wrap these functions as tools.

const apiUrl = process.env.LAUNCHSENSE_API_URL ?? "https://harmless-chihuahua-667.convex.site";

async function post(path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: "The LaunchSense API returned invalid JSON." };
  }
  if (!response.ok) throw new Error(data.error ?? `LaunchSense API error ${response.status}`);
  return data;
}

export async function listTools() {
  const response = await fetch(`${apiUrl}/api/mcp/tools`);
  if (!response.ok) throw new Error(`LaunchSense API error ${response.status}`);
  return response.json();
}

export async function scanPublicRepo(repoUrl) {
  return post("/api/mcp/scan", { repoUrl });
}

export async function getReport(scanId) {
  return post("/api/mcp/report", { scanId });
}

export async function explainFindings(scanId) {
  // This becomes available once the public explain route exists. Do not fake a
  // result here. An unavailable tool must say unavailable.
  throw new Error("Explain findings is not public through MCP yet.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.error("This file is an adapter. Wrap its functions in an MCP host.");
}