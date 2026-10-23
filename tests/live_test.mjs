// End-to-end test against a real Arma 3 scenario running the mod (test mission on Stratis).
//   node tests/live_test.mjs [port]
const port = Number(process.argv[2] ?? 8765);
const base = `http://127.0.0.1:${port}`;
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`);
  if (!ok) failures++;
}

async function cmd(name, args) {
  const t = Date.now();
  const r = await fetch(`${base}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: name, args }) });
  const body = await r.json();
  body.ms = Date.now() - t;
  return body;
}
const getState = async () => (await fetch(`${base}/state`)).json();
const find = (list, id) => list.find((x) => x.id === id);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const show = (r) => (r.ok ? JSON.stringify(r.result) : `${r.error.code}: ${r.error.message}`) + ` (${r.ms} ms)`;

// Wait for the server to load the scenario.
const deadline = Date.now() + 240000;
let health = null;
while (Date.now() < deadline) {
  try {
    health = await (await fetch(`${base}/health`)).json();
    if (health.game_connected) break;
  } catch {}
  await sleep(1000);
}
check(health?.game_connected, "scenario connected to the gateway", JSON.stringify(health?.mission));
if (!health?.game_connected) process.exit(1);
await sleep(1500);

let st = await getState();
check(st.world.world === "Stratis" && st.world.mission === "a3b_test", "world block from the real engine", JSON.stringify(st.world));
console.log(`     initial state: ${st.units.length} units, ${st.vehicles.length} vehicles, ${st.groups.length} groups, ${st.objects.length} objects`);

// exec_sqf
let r = await cmd("exec_sqf", { code: "1 + 1" });
check(r.ok && r.result.result === 2, "exec_sqf 1 + 1", show(r));
r = await cmd("exec_sqf", { code: "params ['_a', '_b']; format ['%1 %2', _a, _b]", args: ["Bonjour", "l'équipe \"Alpha\""] });
check(r.ok && r.result.result === "Bonjour l'équipe \"Alpha\"", "exec_sqf with arguments, quotes and accents", show(r));
r = await cmd("exec_sqf", { code: "productVersion select 2" });
console.log(`     engine build: ${JSON.stringify(r.result)}`);

// spawn_unit
const west = await cmd("spawn_unit", { type: "B_Soldier_F", pos: [2950, 6000], side: "west", dir: 90 });
check(west.ok && /^u\d+$/.test(west.result.id), "spawn_unit west", show(west));
// Far enough that the west group does not stop to fight it during the move test.
const east = await cmd("spawn_unit", { type: "O_Soldier_F", pos: [3900, 6900], side: "east" });
check(east.ok && east.result.group !== west.result.group, "spawn_unit east in its own group", show(east));
const mate = await cmd("spawn_unit", { type: "B_medic_F", pos: [2952, 6002], group: west.result.group });
check(mate.ok && mate.result.group === west.result.group, "spawn_unit joining an existing group", show(mate));
const badClass = await cmd("spawn_unit", { type: "Not_A_Real_Class", pos: [2950, 6000] });
check(!badClass.ok && badClass.error.code === "execution_error" && /unknown class/.test(badClass.error.message), "unknown class reported by the game", show(badClass));

await sleep(400);
st = await getState();
const wu = find(st.units, west.result.id);
check(wu && dist(wu.pos, [2950, 6000]) < 2 && wu.side === "west" && wu.alive && wu.type === "B_Soldier_F", "new unit visible in the state", JSON.stringify(wu));

// spawn_vehicle with crew, spawn_object
const veh = await cmd("spawn_vehicle", { type: "B_MRAP_01_F", pos: [2960, 5980], dir: 45, crew: true });
check(veh.ok && veh.result.crew.length > 0 && /^g\d+$/.test(veh.result.group), "spawn_vehicle with crew", show(veh));
const box = await cmd("spawn_object", { type: "Box_NATO_Ammo_F", pos: [2945, 5995] });
check(box.ok && /^o\d+$/.test(box.result.id), "spawn_object", show(box));
await sleep(400);
st = await getState();
const v = find(st.vehicles, veh.result.id);
check(v && v.crew.length === veh.result.crew.length && v.fuel > 0, "vehicle and crew in the state", JSON.stringify(v));
check(!!find(st.objects, box.result.id), "object in the state", JSON.stringify(find(st.objects, box.result.id)));
const crewUnit = find(st.units, veh.result.crew[0]);
check(crewUnit && crewUnit.vehicle === veh.result.id, "crew member reports its vehicle", JSON.stringify(crewUnit));

// set_behaviour and move
r = await cmd("set_behaviour", { id: east.result.group, behaviour: "aware", combat_mode: "red", speed_mode: "full" });
check(r.ok && r.result.combat_mode === "red" && r.result.speed_mode === "full", "set_behaviour", show(r));
r = await cmd("move", { id: west.result.group, pos: [3010, 6060] });
check(r.ok, "move group", show(r));
// AI path planning can take several seconds on a loaded server: wait for 10 m of progress.
const startPos = wu.pos;
let moved = null;
for (let i = 0; i < 15; i++) {
  await sleep(2000);
  st = await getState();
  moved = find(st.units, west.result.id);
  if (dist(moved.pos, [3010, 6060]) < dist(startPos, [3010, 6060]) - 10) break;
}
const grp = find(st.groups, west.result.group);
check(moved && dist(moved.pos, [3010, 6060]) < dist(startPos, [3010, 6060]) - 10, "group walks toward its destination", `from ${startPos.map(Math.round)} to ${moved?.pos.map(Math.round)}, speed ${moved?.speed}`);
// The engine nudges waypoints to a reachable spot, so allow a few metres.
check(grp && grp.destination.length === 3 && dist(grp.destination, [3010, 6060]) < 10, "group destination in the state", JSON.stringify(grp?.destination));

// teleport
r = await cmd("teleport", { id: east.result.id, pos: [3100, 6100], dir: 180 });
check(r.ok, "teleport", show(r));
await sleep(400);
st = await getState();
const tp = find(st.units, east.result.id);
check(tp && dist(tp.pos, [3100, 6100]) < 1.5, "teleported unit at its new position", JSON.stringify(tp?.pos));

// set_health and events
r = await cmd("set_health", { id: east.result.id, health: 0.4 });
check(r.ok && Math.abs(r.result.health - 0.4) < 0.01 && r.result.alive, "set_health 0.4", show(r));
r = await cmd("set_health", { id: east.result.id, health: 0 });
check(r.ok && r.result.alive === false, "set_health 0 kills", show(r));
r = await cmd("set_health", { id: west.result.group, health: 1 });
check(!r.ok && /not a group/.test(r.error.message), "set_health on a group refused by the game", show(r));

// message and environment
for (const kind of ["system", "hint", "title", "side_chat", "subtitle"]) {
  r = await cmd("message", { text: `Test A3 Bridge (${kind}) : éàç`, kind, to: "all" });
  check(r.ok, `message ${kind}`, show(r));
}
r = await cmd("set_environment", { time: 6.5, overcast: 0.8, fog: 0.1 });
check(r.ok && Math.abs(r.result.daytime - 6.5) < 0.05, "set_environment time", show(r));
await sleep(400);
st = await getState();
check(Math.abs(st.world.daytime - 6.5) < 0.1 && st.world.overcast > 0.7, "new time and weather in the state", `daytime ${st.world.daytime}, overcast ${st.world.overcast}`);

// delete
r = await cmd("delete", { id: box.result.id });
check(r.ok, "delete object", show(r));
r = await cmd("delete", { id: veh.result.id });
check(r.ok, "delete vehicle with crew", show(r));
await sleep(500);
st = await getState();
check(!find(st.objects, box.result.id) && !find(st.vehicles, veh.result.id) && !find(st.units, veh.result.crew[0]), "deleted entities gone from the state");
r = await cmd("move", { id: box.result.id, pos: [0, 0] });
check(!r.ok && /unknown or deleted id/.test(r.error.message), "commands on deleted ids fail cleanly", show(r));

// events
const ev = await (await fetch(`${base}/events?since=0&limit=5000`)).json();
const kinds = {};
for (const e of ev.events) kinds[e.event] = (kinds[e.event] ?? 0) + 1;
check(kinds.mission_started && kinds.created && kinds.killed && kinds.deleted, "events from the engine", JSON.stringify(kinds));
const killed = ev.events.find((e) => e.event === "killed" && e.data.id === east.result.id);
check(!!killed, "killed event for the unit we killed", JSON.stringify(killed?.data));

// Load: 120 more AI in 10 squads of 12 (the engine caps groups at 288 per side), then measure the stream.
const t = Date.now();
const leaders = await Promise.all(
  Array.from({ length: 10 }, (_, s) => cmd("spawn_unit", { type: "O_Soldier_SL_F", pos: [3200, 6200 + s * 10], side: "east" }))
);
const many = leaders.concat(
  await Promise.all(
    Array.from({ length: 110 }, (_, i) =>
      cmd("spawn_unit", { type: "O_Soldier_F", pos: [3205 + (i % 11) * 3, 6200 + Math.floor(i / 11) * 10], group: leaders[Math.floor(i / 11)].result?.group ?? "none" })
    )
  )
);
const bad = many.find((x) => !x.ok);
check(!bad, "120 units spawned in 10 squads", bad ? show(bad) : `${Date.now() - t} ms`);
r = await cmd("spawn_unit", { type: "O_Soldier_F", pos: [3300, 6300], group: west.result.id });
check(r.ok && r.result.group === west.result.group, "group parameter also accepts a unit id", show(r));
const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
let n = 0, bytes = 0, last = null;
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.type === "state") { n++; bytes += m.data.length; last = msg; } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await sleep(500);
const n0 = n, b0 = bytes, t0 = Date.now();
await sleep(5000);
const rate = ((n - n0) * 1000) / (Date.now() - t0);
check(rate > 7, "state stream rate with ~140 units", `${rate.toFixed(1)}/s, ${Math.round((bytes - b0) / (n - n0) / 1024)} KB per snapshot, ${last.units.length} units, server fps ${last.world.fps}`);
ws.close();

console.log(failures ? `${failures} check(s) FAILED` : "ALL LIVE CHECKS PASSED");
process.exit(failures ? 1 : 0);
