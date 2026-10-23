// Live test of the tactical orders and the questions, in an Altis town far from every player.
//   node tests/live_tactics_test.mjs [port]
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
const show = (r) => (r.ok ? JSON.stringify(r.result) : `${r.error.code}: ${r.error.message}`).slice(0, 300) + ` (${r.ms} ms)`;
const state = async () => (await fetch(`${base}/state`)).json();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const at = (p, dx, dy) => [p[0] + dx, p[1] + dy];
const created = [];

const towns = { Kavala: [3560, 13000], Pyrgos: [16800, 12650], Sofia: [25700, 21300], Athira: [13950, 18700], Zaros: [9100, 11900] };
let st = await state();
const players = st.units.filter((u) => u.is_player).map((u) => u.pos);
const far = (p) => Math.min(...players.map((q) => dist(q, p)), 1e9);
const [town, T] = Object.entries(towns).sort((a, b) => far(b[1]) - far(a[1]))[0];
console.log(`target: ${town} ${T}, nearest player ${Math.round(Math.min(far(T), 99999))} m`);
check(far(T) > 2000, "test area far from players");

// Questions first: they change nothing.
const terrain = await cmd("query_terrain", { pos: T, radius: 150 });
check(terrain.ok && terrain.result.buildings > 0 && terrain.result.location.length === 3, "query_terrain", show(terrain));
const vis = await cmd("query_visibility", { from: T, to: at(T, 300, 0) });
check(vis.ok && vis.result.distance > 250 && typeof vis.result.terrain_blocked === "boolean", "query_visibility", show(vis));

// A squad defends the town's buildings; another one patrols; a third gets new waypoints.
const def = await cmd("spawn_group", { group: "West/BLU_F/Infantry/BUS_InfSquad", pos: T });
created.push(def.result?.group);
const defend = await cmd("defend", { id: def.result.group, pos: T, radius: 120 });
check(defend.ok && defend.result.positions > 0 && defend.result.garrisoned > 0, "defend: soldiers sent into buildings", show(defend));
const pat = await cmd("spawn_group", { group: "West/BLU_F/Infantry/BUS_InfTeam", pos: at(T, 200, 200) });
created.push(pat.result?.group);
const patrol = await cmd("patrol", { id: pat.result.group, pos: at(T, 200, 200), radius: 150 });
check(patrol.ok && patrol.result.waypoints >= 3, "patrol: patrol loop created", show(patrol));
const wp1 = await cmd("add_waypoint", { id: pat.result.group, pos: at(T, 400, 0), type: "move", replace: true, speed_mode: "full", formation: "line" });
const wp2 = await cmd("add_waypoint", { id: pat.result.group, pos: at(T, 400, 200), type: "sad", behaviour: "combat" });
check(wp1.ok && wp2.ok && wp2.result.waypoints === wp1.result.waypoints + 1, "add_waypoint: replace then append", `${show(wp1)} / ${show(wp2)}`);
const beh = await cmd("set_behaviour", { id: pat.result.group, formation: "stag_column", stance: "middle" });
check(beh.ok && beh.result.formation === "stag column", "set_behaviour with formation and stance", show(beh));
const qg = await cmd("query_group", { id: pat.result.group });
check(qg.ok && qg.result.waypoints.length >= 3 && qg.result.units.length === 4 && qg.result.formation === "stag column", "query_group", show(qg));

// Area and knowledge.
await sleep(1500);
const area = await cmd("query_area", { pos: T, radius: 300, side: "west" });
check(area.ok && area.result.units.length >= 12 && area.result.by_side.some(([s, n]) => s === "west" && n >= 12), "query_area", show(area));
const enemy = await cmd("spawn_group", { group: "East/OPF_F/Infantry/OIA_InfTeam", pos: at(T, -350, 0) });
created.push(enemy.result?.group);
const attack = await cmd("attack", { id: pat.result.group, target: enemy.result.group });
check(attack.ok && attack.result.target === enemy.result.units[0], "attack: target revealed and destroy waypoint", show(attack));
await sleep(1500);
const know = await cmd("query_knowledge", { side: "west", min_level: 0.1 });
check(know.ok && know.result.targets.some((t) => enemy.result.units.includes(t[0])), "query_knowledge sees the revealed enemy", show(know));

// Vehicles: a truck, the defenders' neighbours climb in, then out; a paradrop; supplies.
const truck = await cmd("spawn_vehicle", { type: "B_Truck_01_transport_F", pos: at(T, 0, -250) });
created.push(truck.result?.id);
const riders = await cmd("spawn_group", { group: "West/BLU_F/Infantry/BUS_InfTeam", pos: at(T, 10, -260) });
created.push(riders.result?.group);
const getIn = await cmd("vehicle_crew", { id: riders.result.group, action: "get_in", vehicle: truck.result.id, instant: true });
await sleep(500);
st = await state();
const aboard = riders.result.units.filter((id) => st.units.find((u) => u.id === id)?.vehicle === truck.result.id).length;
check(getIn.ok && aboard === 4, "vehicle_crew get_in (instant)", `${show(getIn)}, ${aboard}/4 aboard`);
const getOut = await cmd("vehicle_crew", { id: riders.result.group, action: "get_out", instant: true });
check(getOut.ok && getOut.result.count === 4, "vehicle_crew get_out", show(getOut));
const supplies = await cmd("set_supplies", { id: truck.result.id, fuel: 0.2, ammo: 0.5 });
await sleep(800);
const fuel = (await state()).vehicles.find((v) => v.id === truck.result.id)?.fuel;
check(supplies.ok && Math.abs(fuel - 0.2) < 0.02, "set_supplies fuel", `${show(supplies)}, fuel ${fuel}`);
const drop = await cmd("paradrop", { id: riders.result.group, pos: at(T, 100, -400), altitude: 250 });
await sleep(1500);
const height = await sqf("private _u = (allUnits select {(_x getVariable ['a3b_id', '']) == (_this select 0)}) param [0, objNull]; if (isNull _u) then {-1} else {round ((getPosATL _u) select 2)}", [riders.result.units[0]]);
check(drop.ok && drop.result.count === 4 && height > 100, "paradrop: soldiers in the air under canopy", `${show(drop)}, first at ${height} m`);

// Equipment.
const loadout = await cmd("set_loadout", { id: def.result.units[1], from_class: "B_soldier_LAT_F" });
await sleep(800);
const launcher = await sqf("secondaryWeapon ((allUnits select {(_x getVariable ['a3b_id', '']) == (_this select 0)}) select 0)", [def.result.units[1]]);
check(loadout.ok && typeof launcher === "string" && launcher !== "", "set_loadout gives the AT soldier's launcher", `${show(loadout)}, launcher ${launcher}`);
const crate = await cmd("spawn_object", { type: "Box_NATO_Wps_F", pos: at(T, 20, 20) });
created.push(crate.result?.id);
const fill = await cmd("fill_crate", { id: crate.result.id, clear: true, items: [["arifle_MX_F", 2], ["30Rnd_65x39_caseless_mag", 10], ["FirstAidKit", 5], ["B_AssaultPack_mcamo", 1]] });
// The cargo shows up on the next frame.
await sleep(1000);
const contents = await sqf("private _b = ((allMissionObjects 'All') select {(_x getVariable ['a3b_id', '']) == (_this select 0)}) select 0; [weaponCargo _b, magazineCargo _b, itemCargo _b, backpackCargo _b] apply {count _x}", [crate.result.id]);
check(fill.ok && fill.result.added === 18 && JSON.stringify(contents) === "[2,10,5,1]", "fill_crate with weapons, magazines, items and a backpack", `${show(fill)}, contents ${JSON.stringify(contents)}`);
const badItem = await cmd("fill_crate", { id: crate.result.id, items: [["NoSuchThing_F", 1]] });
check(!badItem.ok && /unknown item class/.test(badItem.error.message), "unknown item class reported", show(badItem));

// Real artillery: a self-propelled gun with crew fires on an empty spot far from everyone.
const gun = await cmd("spawn_vehicle", { type: "B_MBT_01_arty_F", pos: at(T, -1200, -800), crew: true });
created.push(gun.result?.id, gun.result?.group);
await sleep(2000);
const fire = await cmd("artillery_fire", { id: gun.result.id, pos: at(T, -1200, 2500), rounds: 2 });
check(fire.ok && fire.result.eta > 0, "artillery_fire with a real gun", show(fire));
const notArty = await cmd("artillery_fire", { id: truck.result.id, pos: T });
check(!notArty.ok && /not artillery/.test(notArty.error.message), "a truck is refused as artillery", show(notArty));

// Clean up everything the test created.
await sleep(fire.ok ? Math.min(60, fire.result.eta + 5) * 1000 : 1000);
for (const id of created.filter(Boolean)) await cmd("delete", { id });
console.log(failures ? `${failures} check(s) FAILED` : "ALL TACTICS CHECKS PASSED");
process.exit(failures ? 1 : 0);
