// Drives the web test page in a headless Edge (temporary profile) through the DevTools protocol.
//   node tests/ui_test.mjs <port> <browser.exe> <screenshot dir>
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [port = "8799", exe, shots = "ui_shots"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`); if (!ok) failures++; };
mkdirSync(shots, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "a3b-ui-"));
const browser = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
  "--remote-debugging-port=9333", "--window-size=1500,900", "about:blank"], { stdio: "ignore" });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = await (await fetch(`http://127.0.0.1:9333/json/new?http://127.0.0.1:${port}/ui`, { method: "PUT" })).json(); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
};
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, name), Buffer.from(r.result.data, "base64")); };
const click = async (x, y) => {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
};
const lastResult = () => js(`document.querySelector("#results .res")?.innerText ?? ""`);

await cdp("Runtime.enable");
await cdp("Page.enable");
await cdp("Page.reload");
await sleep(3000);

// 1. Page boots, connects and draws the live state.
const head = await js(`({ws: document.querySelector("#d-ws").className, game: document.querySelector("#d-game").className, mission: document.querySelector("#mission").textContent, rate: document.querySelector("#s-rate").textContent, units: document.querySelector("#s-units").textContent, cmds: document.querySelectorAll("#cmd option").length, presets: document.querySelectorAll("#presets button").length, banner: document.querySelector("#banner").className})`);
check(head.ws.includes("on") && head.game.includes("on"), "gateway and game shown as connected", head.mission);
check(Number(head.rate) >= 8, "state rate shown", head.rate + "/s");
const schemaCount = (await (await fetch(`http://127.0.0.1:${port}/schema`)).json()).tools.length;
check(head.cmds === schemaCount && head.presets >= 10, "one form per command and the shortcuts", `${head.cmds} commands, ${head.presets} shortcuts`);
const painted = await js(`(() => { const c = document.querySelector("#map"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60 && d[i + 2] > 200) n++; return n; })()`);
check(painted > 50, "blue units painted on the map", `${painted} pixels`);
await shot("1-start.png");

// 2. Shortcut: soldier near the player.
await js(`[...document.querySelectorAll("#presets button")].find(b => b.textContent.startsWith("Soldat OTAN")).click()`);
await sleep(600);
let r = await lastResult();
check(/spawn_unit[\s\S]*ok[\s\S]*"id":"u\d+"/.test(r), "shortcut spawns a soldier", r.replace(/\s+/g, " "));

// 3. Form: spawn_vehicle with a position picked on the map.
await js(`(() => { const s = document.querySelector("#cmd"); s.value = "spawn_vehicle"; s.dispatchEvent(new Event("change")); })()`);
const fields = await js(`[...document.querySelectorAll("#fields .field")].map(f => f.dataset.name + ":" + f.dataset.kind).join(" ")`);
check(fields === "type:text pos:position dir:number crew:boolean side:enum", "spawn_vehicle form built from the schema", fields);
// An empty spot 100 m north-east of the player, so the click picks a point instead of selecting a unit.
const empty = await js(`(() => { const p = toScreen([me().pos[0] + 100, me().pos[1] + 100]); const r = document.querySelector("#map").getBoundingClientRect(); return {x: p[0] + r.left, y: p[1] + r.top}; })()`);
await click(empty.x, empty.y);
await sleep(200);
const picked = await js(`[...document.querySelectorAll('#fields .field[data-kind="position"] input')].map(i => i.value)`);
check(picked[0] !== "" && picked[1] !== "", "map click fills the position", picked.join(", "));
await js(`document.querySelector("#send").click()`);
await sleep(600);
r = await lastResult();
check(/spawn_vehicle[\s\S]*ok[\s\S]*"id":"v\d+"/.test(r), "form sends spawn_vehicle", r.replace(/\s+/g, " "));

// 4. A game-side error is displayed.
await js(`(() => { const s = document.querySelector("#cmd"); s.value = "set_health"; s.dispatchEvent(new Event("change")); document.querySelector('#fields [data-name="id"] input').value = "u99999"; document.querySelector('#fields [data-name="health"] input').value = "1"; document.querySelector("#send").click(); })()`);
await sleep(600);
r = await lastResult();
check(/erreur[\s\S]*unknown or deleted id/.test(r), "game error shown in the results", r.replace(/\s+/g, " "));
await js(`(() => { document.querySelector('#fields [data-name="health"] input').value = "5"; document.querySelector('#fields [data-name="id"] input').value = "u3"; document.querySelector("#send").click(); })()`);
await sleep(400);
r = await lastResult();
check(/invalid_args/.test(r), "validation error shown in the results", r.replace(/\s+/g, " "));

// 5. Click a unit on the map: selection panel and its actions.
// toScreen is relative to the canvas; mouse events are relative to the page.
const at = await js(`(() => { const u = S.state.units.find(u => !u.vehicle && u.alive && !u.is_player); const p = toScreen(u.pos); const r = document.querySelector("#map").getBoundingClientRect(); return {id: u.id, x: p[0] + r.left, y: p[1] + r.top}; })()`);
await click(at.x, at.y);
await sleep(300);
const sel = await js(`document.querySelector("#selbox").innerText`);
check(sel.includes(at.id), "clicking a unit selects it", sel.split("\n")[0]);
await js(`[...document.querySelectorAll("#selbox button")].find(b => b.textContent === "Tuer").click()`);
await sleep(600);
r = await lastResult();
check(/set_health[\s\S]*"alive":false/.test(r), "selection action kills the unit", r.replace(/\s+/g, " "));
await shot("2-selection.png");

// 6. Entities and events tabs.
await js(`document.querySelector('[data-tab="t-ent"]').click()`);
await sleep(700);
const rows = await js(`document.querySelectorAll("#enttable tr[data-id]").length`);
check(rows >= 40, "entities table lists the units", `${rows} rows`);
await shot("3-entities.png");
await js(`document.querySelector('[data-tab="t-ev"]').click()`);
await sleep(700);
// Shots flood the list, so look for the kill with the tab's own filter.
await js(`(() => { const f = document.querySelector("#evfilter"); f.value = "killed"; f.dispatchEvent(new Event("change")); })()`);
await sleep(300);
const evs = await js(`[...document.querySelectorAll("#evlist .ev")].map(e => e.innerText).slice(0, 3)`);
check(evs.length > 0 && evs.every((e) => e.includes("killed")), "events tab shows live events, filterable by type", evs.join(" | "));
await js(`(() => { const f = document.querySelector("#evfilter"); f.value = ""; f.dispatchEvent(new Event("change")); })()`);
await shot("4-events.png");

// 7. Background map: loaded for the scenario's world, drawn under the units, layers toggle.
const mapText = await js(`document.querySelector("#mapstatus").textContent`);
check(/^carte de /.test(mapText), "map of the current world loaded", mapText);
const terrain = await js(`(() => { const d = bgc.getImageData(0, 0, bg.width, bg.height).data; let land = 0, sea = 0; for (let i = 0; i < d.length; i += 16) { if (d[i] > 120 && d[i + 1] > 120 && d[i + 2] < d[i] ) land++; if (d[i + 2] > d[i] + 30 && d[i + 2] > 120) sea++; } return {land, sea}; })()`);
check(terrain.land > 1000 && terrain.sea > 1000, "terrain and sea painted behind the units", JSON.stringify(terrain));
await js(`document.querySelector("#v-all").click()`);
await sleep(500);
await shot("5-map-overview.png");
await js(`(() => { S.view.cx = 4100; S.view.cy = 4330; S.view.scale = 2.2; S.dirty = true; })()`);
await sleep(500);
await shot("6-map-village.png");
const names = await js(`S.map.data.places.map(p => p[0]).join(", ")`);
check(names.includes("Agios Fakos"), "place names available", names);
await js(`document.querySelector('[data-layer="relief"]').click()`);
await sleep(300);
const off = await js(`(() => { const d = bgc.getImageData(Math.floor(bg.width / 2), Math.floor(bg.height / 2), 1, 1).data; return [...d.slice(0, 3)]; })()`);
check(off.join() === "233,228,212", "relief layer can be hidden", off.join());
await js(`document.querySelector('[data-layer="relief"]').click()`);

// 8. Catalog tab: pick a group, place it by clicking the map, then a marker on the picked point.
await js(`document.querySelector('[data-tab="t-cat"]').click()`);
await sleep(800);
const catRows = await js(`document.querySelectorAll("#cattable tr[data-v]").length`);
check(catRows > 0, "catalog tab lists entries", `${catRows} rows`);
await js(`document.querySelector('#catsub [data-k="groups"]').click()`);
await sleep(200);
await js(`document.querySelector("#cattable tr[data-v]").click()`);
await sleep(200);
const placing = await js(`({cmd: document.querySelector("#cmd").value, banner: document.querySelector("#placing").textContent, on: S.placing, group: document.querySelector('#fields [data-name="group"] input').value})`);
check(placing.cmd === "spawn_group" && placing.on && placing.group.includes("/"), "picking a group prepares spawn_group and placing", JSON.stringify(placing));
// The previous step zoomed on the village: bring the player back into view before clicking near them.
await js(`document.querySelector("#v-me").click()`);
await sleep(300);
const spot = await js(`(() => { const p = toScreen([me().pos[0] - 120, me().pos[1] + 80]); const r = document.querySelector("#map").getBoundingClientRect(); return {x: p[0] + r.left, y: p[1] + r.top}; })()`);
await click(spot.x, spot.y);
await sleep(700);
r = await lastResult();
check(/spawn_group[\s\S]*ok[\s\S]*"group":"g\d+"/.test(r), "clicking the map places the group", r.replace(/\s+/g, " "));
await js(`document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))`);
check(!(await js(`S.placing`)), "Escape stops placing");
const datalist = await js(`document.querySelectorAll("#dl-cat-units option").length`);
check(datalist > 0, "catalog feeds the form suggestions", `${datalist} unit classes`);
await js(`[...document.querySelectorAll("#presets button")].find(b => b.textContent.startsWith("Marqueur objectif")).click()`);
await sleep(700);
const markerHit = await js(`S.hits.some(h => h.id.startsWith("marker:"))`);
check(markerHit, "marker drawn on the map");
await shot("16-catalog-marker.png");

// 9. Shots layer: tracers from fired events, and the layer button hides them.
await js(`document.querySelector("#v-me").click()`);
await sleep(1200);
const tracers = await js(`S.shots.length`);
check(tracers > 0, "fired events become tracers", `${tracers} on screen`);
await shot("17-tracers.png");
await js(`document.querySelector('[data-layer="shots"]').click()`);
check((await js(`S.layers.shots`)) === false, "shots layer can be turned off");
await js(`document.querySelector('[data-layer="shots"]').click()`);

// 10. Analyses layer: a visibility and a cover question drawn on the map.
await js(`(() => { const s = document.querySelector("#cmd"); s.value = "query_cover"; s.dispatchEvent(new Event("change")); })()`);
await js(`(() => { const p = me().pos; const f = [...document.querySelectorAll('#fields .field[data-kind="position"]')]; const set = (w, q) => { const i = w.querySelectorAll("input"); i[0].value = q[0]; i[1].value = q[1]; }; set(f[0], p); set(f[1], [p[0] + 200, p[1]]); document.querySelector("#send").click(); })()`);
await sleep(600);
const overlay = await js(`S.overlay && S.overlay.cmd`);
check(overlay === "query_cover", "query_cover result drawn as an overlay", String(overlay));
await shot("18-cover.png");

// 11. Review tab: the game in progress is recorded and can be replayed on the map.
await sleep(1500);
await js(`document.querySelector('[data-tab="t-rev"]').click()`);
await sleep(800);
const recRows = await js(`[...document.querySelectorAll("#revtable tr[data-rid]")].map(r => r.innerText.replace(/\\s+/g, " "))`);
check(recRows.length > 0 && /en cours/.test(recRows[0]), "review tab lists the game being recorded", recRows[0]);
await js(`document.querySelector("#revtable tr[data-rid]").click()`);
await sleep(1500);
const rev = await js(`({on: !!S.replay, bar: document.querySelector("#replaybar").classList.contains("show"), frames: S.replay?.frames.length, replayState: !!S.state?.replay,
  units: S.state?.units.length, ui: S.replay?.moments.filter(m => m.c?.source === "ui").map(m => m.c.cmd), moments: document.querySelectorAll("#momlist .ev").length})`);
check(rev.on && rev.bar && rev.replayState && rev.frames > 5 && rev.units > 0, "opening a recording shows it on the map with the playback bar", JSON.stringify({ frames: rev.frames, units: rev.units }));
check(rev.ui.includes("spawn_vehicle") && rev.ui.includes("query_cover") && rev.moments > 0, "orders sent from this page are key moments", rev.ui.join(", "));
const live = await js(`S.live.units.length`);
check(rev.units < live, "the recording starts as the game did, before the soldiers added since", `${rev.units} units at the start, ${live} now`);
await js(`seekReplay((S.replay.start + S.replay.end) / 2)`);
await js(`document.querySelector("#rp-speed").value = "5"; document.querySelector("#rp-play").click()`);
const t0 = await js(`S.replay.t`);
await sleep(1500);
const played = await js(`({t: S.replay.t, playing: S.replay.playing, shots: S.shots.length, time: document.querySelector("#rp-time").textContent})`);
check(played.t > t0 + 3, "playback moves time forward", `${t0.toFixed(1)} -> ${played.t.toFixed(1)} s (${played.time})`);
check(played.shots > 0, "recorded shots replayed as tracers", `${played.shots} tracers`);
await shot("19-review.png");
await js(`setPlaying(false)`);
await js(`(() => { const i = S.replay.moments.findIndex(m => m.c?.cmd === "query_cover"); document.querySelector('#momlist [data-i="' + i + '"]').click(); })()`);
await sleep(300);
const back = await js(`({overlay: S.overlay?.cmd, t: S.replay.t, at: S.replay.moments.find(m => m.c?.cmd === "query_cover").t})`);
check(back.overlay === "query_cover" && Math.abs(back.t - (back.at - 3)) < 1.5, "clicking an analysis moment jumps there and redraws its answer", JSON.stringify(back));
await shot("20-review-moment.png");
await js(`document.querySelector("#rp-live").click()`);
await sleep(500);
const after = await js(`({replay: S.replay, bar: document.querySelector("#replaybar").classList.contains("show"), live: S.state === S.live || !S.state.replay})`);
check(after.replay === null && !after.bar && after.live, "back to the live game");

check(errors.length === 0, "no JavaScript errors", errors.join(" | "));
await cdp("Browser.close").catch(() => {});
browser.kill();
console.log(failures ? `${failures} UI check(s) FAILED` : "ALL UI CHECKS PASSED");
process.exit(failures ? 1 : 0);
