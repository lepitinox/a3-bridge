// Live chat round trip through the MCP server: waits for a player's message, then answers by radio.
//   node tests/live_chat_test.mjs [port] [minutes] [since]   (since: read messages already received after that event number)
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const port = process.argv[2] ?? "8765";
const minutes = Number(process.argv[3] ?? 5);
const server = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "arma_mcp.mjs")], {
  env: { ...process.env, A3B_URL: `http://127.0.0.1:${port}` },
  stdio: ["pipe", "pipe", "inherit"],
});
const waiting = new Map();
createInterface({ input: server.stdout }).on("line", (line) => {
  const msg = JSON.parse(line);
  waiting.get(msg.id)?.(msg);
  waiting.delete(msg.id);
});
let seq = 0;
const rpc = (method, params) => new Promise((resolve) => {
  const id = ++seq;
  waiting.set(id, resolve);
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const call = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return { error: r.result?.isError, data: JSON.parse(r.result.content[0].text) };
};

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "chat-test", version: "1" } });
const deadline = Date.now() + minutes * 60000;
let since = process.argv[4] !== undefined ? Number(process.argv[4]) : undefined;
let got = null;
while (!got && Date.now() < deadline) {
  const r = await call("arma_wait_for_chat", { timeout_s: 60, ...(since !== undefined ? { since } : {}) });
  since = r.data.last_seq;
  if (r.data.messages.length) got = r.data.messages[0];
  else console.log(`  waiting for a chat message... (${Math.round((deadline - Date.now()) / 1000)} s left)`);
}
if (!got) {
  console.log("FAIL no chat message received");
  server.kill();
  process.exit(1);
}
console.log(`PASS chat received through MCP - ${JSON.stringify(got)}`);
const answer = await call("arma_message", { text: `Bien reçu ${got.from}, message « ${got.text} » transmis. Renforts en préparation.`, kind: "side_chat", to: got.side, sender: "Commandant IA" });
console.log(`${answer.error ? "FAIL" : "PASS"} radio answer sent - ${JSON.stringify(answer.data)}`);
const sub = await call("arma_message", { text: "Ici le Commandant IA, je vous reçois.", kind: "subtitle", to: got.side, sender: "Commandant IA" });
console.log(`${sub.error ? "FAIL" : "PASS"} subtitle answer sent - ${JSON.stringify(sub.data)}`);
server.kill();
process.exit(answer.error || sub.error ? 1 : 0);
