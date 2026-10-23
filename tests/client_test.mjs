// Gateway client test: run by tests/fake_game.py (offline) or by hand against a live game:
//   node tests/client_test.mjs <port> [--live]
// --live skips the checks that need the fake game (timeouts, stopping the game).
import net from "node:net";

const port = Number(process.argv[2] ?? 8765);
const live = process.argv.includes("--live");
const base = `http://127.0.0.1:${port}`;
let failures = 0;

function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`);
  if (!ok) failures++;
}

async function post(cmd, args) {
  const r = await fetch(`${base}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  return { status: r.status, body: await r.json() };
}

function rawRequest(lines) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(lines.join("\r\n") + "\r\n\r\n"));
    let data = "";
    s.on("data", (d) => (data += d));
    s.on("end", () => resolve(data));
    s.on("error", () => resolve(data));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Health and state over HTTP.
const health = await (await fetch(`${base}/health`)).json();
check(health.game_connected === true, "health: game connected", JSON.stringify(health.mission));
await sleep(300);
const state = await (await fetch(`${base}/state`)).json();
check(state.type === "state" && Array.isArray(state.units) && state.units.length > 0, "GET /state has units", `${state.units?.length} units`);
const u = state.units?.[0] ?? {};
check(typeof u.id === "string" && Array.isArray(u.pos) && u.pos.length === 3 && typeof u.health === "number", "unit fields are typed", JSON.stringify(u));
check(typeof state.world?.world === "string", "world block present", JSON.stringify(state.world));

// 2. WebSocket stream: rate and commands.
const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
const results = new Map();
let states = 0;
let hello = null;
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.type === "hello") hello = msg;
  else if (msg.type === "state") states++;
  else if (msg.type === "event") events.push(msg);
  else if (msg.type === "result") results.get(msg.id)?.(msg);
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const wsCommand = (id, cmd, args) =>
  new Promise((resolve) => {
    results.set(id, resolve);
    ws.send(JSON.stringify({ type: "command", id, cmd, args }));
  });

await sleep(100);
check(hello && hello.commands.includes("spawn_unit"), "ws hello lists commands", hello?.commands?.join(","));
const s0 = states;
const t0 = Date.now();
await sleep(2000);
const rate = ((states - s0) * 1000) / (Date.now() - t0);
check(rate > 7 && rate < 13, "ws state rate ~10/s", `${rate.toFixed(1)} per second`);

let t = Date.now();
const spawned = await wsCommand("a1", "spawn_unit", { type: "B_Soldier_F", pos: [1500, 2500], side: "west" });
check(spawned.ok && /^u\d+$/.test(spawned.result.id) && /^g\d+$/.test(spawned.result.group), "ws spawn_unit returns ids", `${JSON.stringify(spawned.result)} in ${Date.now() - t} ms`);

const bad = await wsCommand("a2", "spawn_unit", { pos: [1, 2] });
check(!bad.ok && bad.error.code === "invalid_args", "missing parameter rejected", bad.error?.message);
const unknown = await wsCommand("a3", "fly_to_moon", {});
check(!unknown.ok && unknown.error.code === "unknown_command", "unknown command rejected", unknown.error?.message);
const range = await wsCommand("a4", "set_health", { id: "u1", health: 3 });
check(!range.ok && range.error.code === "invalid_args", "out of range value rejected", range.error?.message);

// 3. HTTP commands, game errors and text round trips.
t = Date.now();
const veh = await post("spawn_vehicle", { type: "B_MRAP_01_F", pos: [1510, 2510, 0], dir: 90 });
check(veh.status === 200 && /^v\d+$/.test(veh.body.result?.id), "http spawn_vehicle", `${JSON.stringify(veh.body.result)} in ${Date.now() - t} ms`);

if (!live) {
  const kill = await post("set_health", { id: spawned.result.id, health: 0 });
  check(kill.status === 200 && kill.body.result.alive === false, "http set_health 0 kills", JSON.stringify(kill.body.result));
  const missing = await post("set_health", { id: "u99999", health: 1 });
  check(missing.status === 422 && missing.body.error.code === "execution_error", "game-side error reported", missing.body.error?.message);

  const tricky = 'hint "Bonjour, l\'équipe ""Alpha"" ✓";\n' + "x".repeat(30000);
  const echo = await post("exec_sqf", { code: tricky });
  check(echo.status === 200 && echo.body.result.result === tricky, "30 KB code with quotes/accents survives the round trip", `${tricky.length} chars`);

  t = Date.now();
  const stuck = await post("teleport", { id: "u1", pos: [666, 666] });
  check(stuck.status === 504 && stuck.body.error.code === "timeout", "command with no answer times out", `${stuck.body.error?.message} after ${Date.now() - t} ms`);
}

// 4. Burst: 100 commands at once over WebSocket.
t = Date.now();
const burst = await Promise.all(
  Array.from({ length: 100 }, (_, i) => wsCommand(`b${i}`, "spawn_unit", { type: "B_Soldier_F", pos: [100 + i, 100], side: "east" }))
);
check(burst.every((r) => r.ok), "100 simultaneous commands all succeed", `${Date.now() - t} ms`);

// 5. Events history.
await sleep(300);
const ev = await (await fetch(`${base}/events?since=0&limit=5000`)).json();
const kinds = new Set(ev.events.map((e) => e.event));
check(kinds.has("created") && (live || kinds.has("killed")), "events history has created/killed", [...kinds].join(","));
check(events.length > 0, "events pushed over websocket", `${events.length} events`);

// 6. Schema for LLM tools.
const schema = await (await fetch(`${base}/schema`)).json();
check(schema.tools.length === hello.commands.length && schema.tools[0].input_schema, "GET /schema has one tool per command", `${schema.tools.length} tools`);

// 6b. Background map built by the game and cached by the gateway.
if (!live) {
  const world = state.world.world;
  let map = null;
  for (let i = 0; i < 20 && !map; i++) {
    const r = await fetch(`${base}/map/${world}`);
    if (r.ok) map = await r.json();
    else await sleep(250);
  }
  check(map && map.heights.data.length === map.heights.n ** 2 && map.roads.length > 0 && map.places.length > 0,
    "GET /map/<world> serves the built map", map ? `${map.heights.n}x${map.heights.n} heights, ${map.roads.length} roads, ${map.buildings.length} buildings, ${map.places.length} places` : "missing");
  const shapes = map && map.roads.every((r) => r.length === 6 && typeof r[4] === "string") && map.buildings.every((b) => b.length === 5) && map.places.every((p) => p.length === 4 && typeof p[0] === "string");
  check(shapes && map.roads.length === 91 && map.buildings.length === 48 && map.places.length === 4, "map items keep their shape and count", map ? `${map.roads.length} roads, ${map.buildings.length} buildings, ${map.places.length} places` : "");
  const h2 = await (await fetch(`${base}/health`)).json();
  check(h2.map?.ready === true && h2.map.world === world, "health reports the map as ready", JSON.stringify(h2.map));
  const none = await fetch(`${base}/map/NoSuchWorld`);
  check(none.status === 404, "unknown world map answers 404");
}

// 6c. Catalog, spec and the spawn commands added with it.
const catalog = await (await fetch(`${base}/catalog`)).json();
const secs = Object.keys(catalog.sections ?? {});
check(["units", "vehicles", "objects", "groups", "marker_types", "marker_colors"].every((s) => secs.includes(s)) && catalog.sections.units.rows.length > 0,
  "GET /catalog has every section", secs.map((s) => `${s}=${catalog.sections[s].rows.length}`).join(" "));
const specDoc = await (await fetch(`${base}/spec`)).json();
check(specDoc.types.unit_class.catalog === "units" && specDoc.effects.length > 10, "GET /spec links types to catalog sections", `${specDoc.effects.length} effects`);
if (!live) {
  const squad = await post("spawn_group", { group: "West/BLU_F/Infantry/BUS_InfSquad", pos: [1200, 2100] });
  check(squad.status === 200 && squad.body.result.units.length >= 2 && /^g\d+$/.test(squad.body.result.group), "spawn_group", JSON.stringify(squad.body.result));
  const badGroup = await post("spawn_group", { group: "Nope", pos: [1200, 2100] });
  check(badGroup.status === 422 && /unknown group/.test(badGroup.body.error.message), "spawn_group with a bad path reports it", badGroup.body.error?.message);
  const fx = await post("spawn_effect", { effect: "artillery", pos: [1500, 1500], count: 3, spread: 30 });
  check(fx.status === 200 && fx.body.result.effect === "artillery" && fx.body.result.count === 3, "spawn_effect", JSON.stringify(fx.body.result));
  const badFx = await post("spawn_effect", { effect: "nuke", pos: [1500, 1500] });
  check(badFx.status === 400 && badFx.body.error.code === "invalid_args", "unknown effect rejected before the game", badFx.body.error?.message);
  const mk = await post("set_marker", { pos: [1300, 2200], text: "Objectif", type: "mil_objective", color: "ColorRed" });
  check(mk.status === 200 && /^a3b_marker_/.test(mk.body.result.name), "set_marker creates a marker", JSON.stringify(mk.body.result));
  await sleep(300);
  const withMarker = await (await fetch(`${base}/state`)).json();
  check(withMarker.markers.some((m) => m.name === mk.body.result.name && m.text === "Objectif"), "marker appears in the state", JSON.stringify(withMarker.markers));
  const del = await post("delete_marker", { name: mk.body.result.name });
  check(del.status === 200, "delete_marker", JSON.stringify(del.body.result));
}

// 7. Browser and DNS-rebinding protection.
const fromBrowser = await rawRequest([`GET /health HTTP/1.1`, `Host: 127.0.0.1:${port}`, "Origin: https://evil.example", "Connection: close"]);
check(fromBrowser.startsWith("HTTP/1.1 403"), "request with Origin refused");
const rebinding = await rawRequest([`GET /health HTTP/1.1`, `Host: evil.example:${port}`, "Connection: close"]);
check(rebinding.startsWith("HTTP/1.1 403"), "foreign Host refused");
const ownPage = await rawRequest([`GET /health HTTP/1.1`, `Host: 127.0.0.1:${port}`, `Origin: http://127.0.0.1:${port}`, "Connection: close"]);
check(ownPage.startsWith("HTTP/1.1 200"), "requests from the gateway's own page accepted");
const ui = await fetch(`${base}/ui`);
check(ui.status === 200 && (await ui.text()).includes("A3 Bridge"), "GET /ui serves the test page");

// 8. Subscription control.
ws.send(JSON.stringify({ type: "subscribe", state: false }));
await sleep(300);
const s1 = states;
await sleep(1000);
check(states === s1, "unsubscribing from state stops the stream", `${states - s1} states after unsubscribe`);

// 9. Game gone: commands are refused quickly.
if (!live) {
  console.log("STOP_POLLING");
  await sleep(3500);
  t = Date.now();
  const gone = await post("message", { text: "hello" });
  check(gone.status === 503 && gone.body.error.code === "game_not_running", "game stopped -> game_not_running", `${Date.now() - t} ms`);
}

ws.close();
console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
