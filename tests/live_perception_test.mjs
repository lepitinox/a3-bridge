// Live test of the perception events and query_cover: two hostile squads meet far from every player.
//   node tests/live_perception_test.mjs [port]
const port = Number(process.argv[2] ?? 8765);
const base = `http://127.0.0.1:${port}`;
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`); if (!ok) failures++; };
const cmd = async (name, args) => (await (await fetch(`${base}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: name, args }) })).json());
const show = (r) => (r.ok ? JSON.stringify(r.result) : `${r.error.code}: ${r.error.message}`).slice(0, 260);
const state = async () => (await fetch(`${base}/state`)).json();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const at = (p, dx, dy) => [p[0] + dx, p[1] + dy];

// The test area: an open spot near a town of the current map, far from every player.
const st = await state();
const towns = st.world.world === "Altis"
  ? { Kavala: [3560, 13000], Pyrgos: [16800, 12650], Sofia: [25700, 21300], Zaros: [9100, 11900] }
  : { "Agia Marina": [3000, 6000], Girna: [2050, 2700], Kamino: [7000, 5900] };
const players = st.units.filter((u) => u.is_player).map((u) => u.pos);
const far = (p) => Math.min(...players.map((q) => dist(q, p)), 99999);
const [town, T] = Object.entries(towns).sort((a, b) => far(b[1]) - far(a[1]))[0];
console.log(`area: ${town} ${T} on ${st.world.world}, nearest player ${Math.round(far(T))} m`);
check(far(T) > 1500, "test area far from players");
const since = (await (await fetch(`${base}/events?since=0&limit=1`)).json()).last_seq;

// query_cover near the town, against a threat 200 m east.
const cover = await cmd("query_cover", { pos: T, threat: at(T, 200, 0), radius: 60 });
check(cover.ok && cover.result.positions.length > 0 && cover.result.positions.every(([, vis]) => vis < 0.25), "query_cover finds hidden positions", show(cover));

// Two hostile teams 150 m apart in the open (F = the fight area); the west team first walks a short leg.
const F = st.world.world === "Altis" ? at(T, 600, 600) : [6400, 5400];
console.log(`fight area: ${F}, nearest player ${Math.round(far(F))} m`);
const west = await cmd("spawn_group", { group: "West/BLU_F/Infantry/BUS_InfTeam", pos: at(F, -75, 0) });
const east = await cmd("spawn_group", { group: "East/OPF_F/Infantry/OIA_InfTeam", pos: at(F, 75, 0) });
check(west.ok && east.ok, "two hostile teams spawned", `${show(west)} / ${show(east)}`);
await cmd("add_waypoint", { id: west.result.group, pos: at(F, -65, 10), type: "move", replace: true });
await sleep(6000);
await cmd("attack", { id: west.result.group, target: east.result.group });
await cmd("attack", { id: east.result.group, target: west.result.group });

// Let them fight for up to 60 seconds; events are counted once each, by sequence number.
const wanted = ["enemy_detected", "combat_changed", "fired", "hit", "waypoint_completed"];
const seen = {};
const samples = {};
let from = since;
for (let i = 0; i < 30 && !wanted.every((w) => seen[w]); i++) {
  await sleep(2000);
  const ev = await (await fetch(`${base}/events?since=${from}&limit=5000`)).json();
  for (const e of ev.events) {
    seen[e.event] = (seen[e.event] ?? 0) + 1;
    samples[e.event] ??= e.data;
  }
  from = ev.last_seq;
}
console.log(`     events in the fight: ${JSON.stringify(seen)}`);
check(seen.enemy_detected > 0, "enemy_detected from the engine", JSON.stringify(samples.enemy_detected));
check(seen.combat_changed > 0, "combat_changed from the engine", JSON.stringify(samples.combat_changed));
check(seen.waypoint_completed > 0, "waypoint_completed from the engine", JSON.stringify(samples.waypoint_completed));
const f = samples.fired;
check(seen.fired > 0 && f?.pos?.length === 3 && f?.dir?.length === 3 && Math.abs(Math.hypot(...f.dir) - 1) < 0.05 && f.kind, "fired with origin, unit direction and projectile kind", JSON.stringify(f));
check(seen.hit > 0 || seen.killed > 0, "hit (or killed) events from the fight", JSON.stringify(samples.hit ?? samples.killed));

// The west leader's view of the enemy.
const qg = await cmd("query_group", { id: west.result.group });
check(qg.ok && Array.isArray(qg.result.known_enemies), "query_group lists known enemies", JSON.stringify(qg.result?.known_enemies));

for (const id of [west.result?.group, east.result?.group]) if (id) await cmd("delete", { id });
console.log(failures ? `${failures} check(s) FAILED` : "ALL PERCEPTION CHECKS PASSED");
process.exit(failures ? 1 : 0);
