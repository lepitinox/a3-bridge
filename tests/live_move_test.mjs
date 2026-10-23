// Follows an AI group ordered to move, sampling the state stream until it arrives or 40 s pass.
//   node tests/live_move_test.mjs [port]
const port = Number(process.argv[2] ?? 8765);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cmd = async (name, args) =>
  (await fetch(`${base}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: name, args }) })).json();

const start = [2700, 5800];
const target = [2760, 5860];
const unit = await cmd("spawn_unit", { type: "B_Soldier_F", pos: start, side: "west" });
await cmd("set_behaviour", { id: unit.result.group, behaviour: "safe", combat_mode: "blue", speed_mode: "normal" });
const order = await cmd("move", { id: unit.result.id, pos: target });
console.log("spawned", JSON.stringify(unit.result), "move:", JSON.stringify(order));

const t0 = Date.now();
let arrived = false;
while (Date.now() - t0 < 40000) {
  await sleep(2000);
  const st = await (await fetch(`${base}/state`)).json();
  const u = st.units.find((x) => x.id === unit.result.id);
  const d = dist(u.pos, target);
  console.log(`  t=${((Date.now() - t0) / 1000).toFixed(0)}s pos=${u.pos.map(Math.round)} speed=${Math.round(u.speed)} km/h, ${Math.round(d)} m to go`);
  if (d < 8) {
    arrived = true;
    break;
  }
}
console.log(arrived ? "PASS unit reached its destination" : "FAIL unit did not arrive in 40 s");
process.exit(arrived ? 0 : 1);
