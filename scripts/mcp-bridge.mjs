#!/usr/bin/env node
// A stdio-to-HTTP bridge for MCP hosts that accept local commands only.
// The key stays in the child environment; stdout contains protocol data only.
import { createInterface } from "node:readline";

const endpoint = new URL(
  process.env.TMD_MCP_URL || "http://127.0.0.1:3000/api/mcp",
);
const key = process.env.TMD_MCP_KEY;
if (
  !key ||
  (endpoint.protocol !== "https:" &&
    !(
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
    )) ||
  endpoint.username ||
  endpoint.password
) {
  console.error(
    "Set TMD_MCP_KEY and a local HTTP or trusted HTTPS TMD_MCP_URL.",
  );
  process.exit(1);
}
let protocol = "2025-11-25";
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  let message;
  try {
    if (Buffer.byteLength(line) > 16384) throw new Error();
    message = JSON.parse(line);
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${key}`,
        "MCP-Protocol-Version": protocol,
      },
      body: JSON.stringify(message),
    });
    if (!response.ok)
      throw new Error(
        `MCP request failed (${response.status}). Check the server address and access key.`,
      );
    const body = await response.text();
    if (!body) continue;
    const replies = response.headers
      .get("content-type")
      ?.includes("text/event-stream")
      ? body
          .split(/\r?\n\r?\n/)
          .map((event) =>
            event
              .split(/\r?\n/)
              .filter((row) => row.startsWith("data:"))
              .map((row) => row.slice(5).trimStart())
              .join("\n"),
          )
          .filter(Boolean)
          .map((value) => JSON.parse(value))
      : [JSON.parse(body)];
    for (const reply of replies) {
      if (message.method === "initialize" && reply.result?.protocolVersion)
        protocol = reply.result.protocolVersion;
      output(reply);
    }
  } catch (error) {
    if (message && "id" in message)
      output({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message:
            error instanceof Error &&
            error.message.startsWith("MCP request failed")
              ? error.message
              : "Could not reach the MCP server. Check that the app service is running.",
        },
      });
    else console.error("MCP notification could not be forwarded.");
  }
}
