// Live test of spawn_group, spawn_effect, set_marker and delete_marker on Altis, far from every player.
//   node tests/live_spawn_test.mjs [port]
const port = Number(process.argv[2] ?? 8765);
const base = `http://127.0.0.1:${port}`;
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`); if (!ok) failures++; };
const cmd = async (name, args) => {
  const t = Date.now();
  const body = await (await fetch(`${base}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: name, args }) })).json();
  body.ms = Date.now() - t;
  return body;
};
const sqf = async (code, args = []) => (await cmd("exec_sqf", { code, args })).result?.result;
const show = (r) => (r.ok ? JSON.stringify(r.result) : `${r.error.code}: ${r.error.message}`) + ` (${r.ms} ms)`;
const state = async () => (await fetch(`${base}/state`)).json();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const at = (p, dx, dy) => [p[0] + dx, p[1] + dy];

// Pick the Altis town farthest from every player, on dry land.
const towns = { Kavala: [3560, 13000], Pyrgos: [16800, 12650], Sofia: [25700, 21300], Athira: [13950, 18700], Zaros: [9100, 11900], Paros: [20900, 16950] };
let st = await state();
const players = st.units.filter((u) => u.is_player).map((u) => u.pos);
const [town, T] = Object.entries(towns).sort((a, b) => Math.min(...players.map((p) => dist(p, b[1])), 1e9) - Math.min(...players.map((p) => dist(p, a[1])), 1e9))[0];
const nearest = Math.min(...players.map((p) => dist(p, T)), 1e9);
const height = await sqf("getTerrainHeightASL _this", T);
console.log(`target: ${town} ${T}, nearest player ${Math.round(nearest)} m, ground ${Math.round(height)} m`);
check(nearest > 2000 && height > 0, "test area far from players and on land");

// spawn_group: an infantry squad and a mechanized squad with its vehicle.
const squad = await cmd("spawn_group", { group: "West/BLU_F/Infantry/BUS_InfSquad", pos: T, dir: 90 });
check(squad.ok && squad.result.units.length === 8 && squad.result.vehicles.length === 0, "spawn_group infantry squad (8 men)", show(squad));
const mech = await cmd("spawn_group", { group: "East/OPF_F/Mechanized/OIA_MechInfSquad", pos: at(T, 300, 0) });
check(mech.ok && mech.result.vehicles.length >= 1 && mech.result.units.length >= 4, "spawn_group mechanized squad with its vehicle", show(mech));
const bad = await cmd("spawn_group", { group: "West/BLU_F/Infantry/NoSuchGroup", pos: T });
check(!bad.ok && /unknown group/.test(bad.error.message), "unknown group path reported", show(bad));
await sleep(500);
st = await state();
const inState = squad.result.units.filter((id) => st.units.some((u) => u.id === id)).length;
check(inState === 8, "squad members visible in the state", `${inState}/8`);
const leader = st.units.find((u) => u.id === squad.result.units[0]);
check(leader && dist(leader.pos, T) < 30, "squad placed at the requested position", JSON.stringify(leader?.pos));

// spawn_effect: a bomb on an empty car must destroy it.
const car = await cmd("spawn_vehicle", { type: "C_Offroad_01_F", pos: at(T, 0, 400) });
await sleep(1000);
const bomb = await cmd("spawn_effect", { effect: "bomb", pos: at(T, 0, 400) });
check(bomb.ok, "spawn_effect bomb", show(bomb));
let carState = null;
for (let i = 0; i < 12; i++) {
  await sleep(1000);
  carState = (await state()).vehicles.find((v) => v.id === car.result.id);
  if (!carState || !carState.alive) break;
}
check(!carState || carState.alive === false, "the bomb destroyed the target car", JSON.stringify(carState ? { alive: carState.alive, health: carState.health } : "deleted"));

// Artillery salvo, smoke, flare, mine.
const arty = await cmd("spawn_effect", { effect: "artillery", pos: at(T, 400, 400), count: 3, spread: 40, delay: 1 });
check(arty.ok && arty.result.count === 3, "spawn_effect artillery salvo answers at once", show(arty));
const smoke = await cmd("spawn_effect", { effect: "smoke_red", pos: at(T, -300, 0) });
await sleep(1500);
const smokes = await sqf("count (_this nearObjects ['SmokeShellRed', 30])", at(T, -300, 0));
check(smoke.ok && smokes >= 1, "red smoke grenade present on the ground", `${smokes} found`);
const flare = await cmd("spawn_effect", { effect: "flare_white", pos: at(T, -300, 300) });
await sleep(500);
const flares = await sqf("count ((_this vectorAdd [0, 0, 150]) nearObjects ['F_40mm_White', 200])", [...at(T, -300, 300), 0]);
check(flare.ok && flares >= 1, "flare burning above the point", `${flares} found`);
const mine = await cmd("spawn_effect", { effect: "mine_at", pos: at(T, -300, -300) });
await sleep(500);
const mines = await sqf("count (allMines select {_x distance2D _this < 10})", at(T, -300, -300));
check(mine.ok && mines === 1, "anti-tank mine laid", `${mines} found`);
const badFx = await cmd("spawn_effect", { effect: "nuke", pos: T });
check(!badFx.ok && badFx.error.code === "invalid_args", "unknown effect refused before the game", show(badFx));

// Markers: an icon with text, a zone, then delete.
const icon = await cmd("set_marker", { pos: T, text: "Test A3 Bridge", type: "mil_objective", color: "ColorRed" });
check(icon.ok, "set_marker icon", show(icon));
const zone = await cmd("set_marker", { name: "a3b_test_zone", pos: T, shape: "rectangle", color: "ColorBLUFOR", size_x: 150, size_y: 100, dir: 30, alpha: 0.6 });
check(zone.ok && zone.result.name === "a3b_test_zone", "set_marker zone with a chosen name", show(zone));
const moved = await cmd("set_marker", { name: "a3b_test_zone", pos: at(T, 50, 0), shape: "rectangle", color: "ColorBLUFOR", size_x: 150, size_y: 100, dir: 30, alpha: 0.6 });
await sleep(400);
st = await state();
const mi = st.markers.find((m) => m.name === icon.result?.name);
const mz = st.markers.filter((m) => m.name === "a3b_test_zone");
check(mi && mi.text === "Test A3 Bridge" && mi.type === "mil_objective", "icon marker in the state", JSON.stringify(mi));
check(moved.ok && mz.length === 1 && mz[0].shape === "rectangle" && Math.round(mz[0].pos[0]) === T[0] + 50, "same name moves the zone instead of duplicating it", JSON.stringify(mz));
const badColor = await cmd("set_marker", { pos: T, color: "ColorPlaid" });
check(!badColor.ok && /unknown marker color/.test(badColor.error.message), "unknown marker colour reported", show(badColor));
const delOk = await cmd("delete_marker", { name: "a3b_test_zone" });
const delAgain = await cmd("delete_marker", { name: "a3b_test_zone" });
check(delOk.ok && !delAgain.ok, "delete_marker, then unknown on second delete", `${show(delOk)} / ${show(delAgain)}`);

// Clean up what the test created, leaving the scenario as it was.
await sleep(4000);
for (const id of [squad.result?.group, mech.result?.group, car.result?.id, ...(mech.result?.vehicles ?? [])]) if (id) await cmd("delete", { id });
if (icon.result?.name) await cmd("delete_marker", { name: icon.result.name });
await sqf("{deleteVehicle _x} forEach (allMines select {_x distance2D _this < 10})", at(T, -300, -300));
console.log(failures ? `${failures} check(s) FAILED` : "ALL SPAWN CHECKS PASSED");
process.exit(failures ? 1 : 0);
