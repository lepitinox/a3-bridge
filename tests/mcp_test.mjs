// Drives mcp/arma_mcp.mjs over stdio like an MCP client (Claude) would, against a running gateway.
//   node tests/mcp_test.mjs <port> [--live]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const port = process.argv[2] ?? "8799";
const live = process.argv.includes("--live");
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
  const text = r.result?.content?.[0]?.text ?? "";
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { error: r.result?.isError, data, text };
};
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`); if (!ok) failures++; };
const cut = (s, n = 220) => (s.length > n ? s.slice(0, n) + "…" : s);

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
check(init.result?.serverInfo?.name === "a3-bridge" && init.result.capabilities.tools, "initialize", init.result?.protocolVersion);
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const list = await rpc("tools/list", {});
const names = list.result.tools.map((t) => t.name);
const schemaCount = (await (await fetch(`http://127.0.0.1:${port}/schema`)).json()).tools.length;
check(names.length === schemaCount + 6 && names.includes("arma_wait_for_events") &&names.includes("arma_wait_for_chat") && names.includes("arma_query_terrain"), "tools/list: every game command plus the read tools", `${names.length} tools`);
check(list.result.tools.every((t) => t.inputSchema?.type === "object"), "every tool has an input schema");

const status = await call("arma_status");
check(!status.error && status.data.game_connected === true, "arma_status", cut(status.text));
const situation = await call("arma_get_situation", { side: "west", include: ["units", "groups"], max: 5 });
check(!situation.error && situation.data.world && situation.data.units.length <= 5, "arma_get_situation filtered and compact", cut(situation.text));
const found = await call("arma_find_in_catalog", { section: "groups", search: "squad", limit: 3 });
check(!found.error && found.data.rows.length > 0 && found.data.fields[0] === "path", "arma_find_in_catalog", cut(found.text));

if (!live) {
  const squad = await call("arma_spawn_group", { group: found.data.rows[0][0], pos: [1200, 2100] });
  check(!squad.error && /^g\d+$/.test(squad.data.group), "a game command through MCP (arma_spawn_group)", cut(squad.text));
  const wp = await call("arma_add_waypoint", { id: squad.data.group, pos: [1400, 2300], type: "sad", replace: true });
  check(!wp.error && wp.data.group === squad.data.group, "arma_add_waypoint", cut(wp.text));
  const terrain = await call("arma_query_terrain", { pos: [4096, 4096] });
  check(!terrain.error && "building_positions" in terrain.data, "arma_query_terrain", cut(terrain.text));
  const area = await call("arma_query_area", { pos: [1000, 2000], radius: 100 });
  check(!area.error && area.data.units.length > 0, "arma_query_area", cut(area.text));
  const bad = await call("arma_patrol", { id: "zz", pos: [1, 2] });
  check(bad.error && /unknown or deleted id/.test(bad.text), "game errors come back as tool errors", cut(bad.text));
  const invalid = await call("arma_add_waypoint", { id: "g1", pos: [1, 2], type: "teleport" });
  check(invalid.error && /invalid_args/.test(invalid.text), "invalid arguments come back as tool errors", cut(invalid.text));
  const chat = await call("arma_wait_for_chat", { timeout_s: 15 });
  check(!chat.error && chat.data.messages.length > 0 && chat.data.messages[0].text, "arma_wait_for_chat receives a player message", cut(chat.text));
  const answer = await call("arma_message", { text: "Bien reçu, renforts en route", kind: "side_chat", to: "west", sender: "Commandant IA" });
  check(!answer.error, "answering by radio with a sender name", cut(answer.text));
  const fights = await call("arma_wait_for_events", { types: ["fired", "waypoint_completed"], timeout_s: 15 });
  check(!fights.error && fights.data.events.length > 0 && fights.data.events.every((e) => ["fired", "waypoint_completed"].includes(e.event)), "arma_wait_for_events with a type filter", cut(fights.text));
  const cover = await call("arma_query_cover", { pos: [1000, 2000], threat: [1300, 2000] });
  check(!cover.error && Array.isArray(cover.data.positions), "arma_query_cover", cut(cover.text));
  const events = await call("arma_get_events", { types: ["chat"], limit: 5 });
  check(!events.error && events.data.events.every((e) => e.event === "chat"), "arma_get_events filtered by type", cut(events.text));
}

const prompts = await rpc("prompts/list", {});
const prompt = await rpc("prompts/get", { name: "commandant_ia", arguments: { side: "west" } });
check(prompts.result.prompts[0]?.name === "commandant_ia" && /arma_wait_for_chat/.test(prompt.result.messages[0].content.text), "commandant_ia prompt");

server.kill();
console.log(failures ? `${failures} MCP check(s) FAILED` : "ALL MCP CHECKS PASSED");
process.exit(failures ? 1 : 0);
