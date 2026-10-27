// Replays a real recorded game in the web page, in a headless Edge (temporary profile), on a running gateway.
//   node tests/live_replay_test.mjs <port> <browser.exe> <screenshot dir> [recording id, default: the longest]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [port = "8765", exe, shots = "ui_shots", wanted] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " - " + detail : ""}`); if (!ok) failures++; };
mkdirSync(shots, { recursive: true });

const list = (await (await fetch(`http://127.0.0.1:${port}/replays`)).json()).replays;
const rec = wanted ? list.find((r) => r.id === wanted) : [...list].sort((a, b) => b.duration - a.duration)[0];
if (!rec) { console.log("no recording to replay"); process.exit(1); }
console.log(`recording ${rec.id}: ${rec.mission} on ${rec.world}, ${Math.round(rec.duration)} s, ${rec.bytes} bytes`);

const profile = mkdtempSync(join(tmpdir(), "a3b-ui-"));
const browser = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
  "--remote-debugging-port=9334", "--window-size=1500,900", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = await (await fetch(`http://127.0.0.1:9334/json/new?http://127.0.0.1:${port}/ui`, { method: "PUT" })).json(); } catch {}
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
};
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, name), Buffer.from(r.result.data, "base64")); };

await cdp("Runtime.enable");
await cdp("Page.enable");
await cdp("Page.reload");
await sleep(3000);

await js(`document.querySelector('[data-tab="t-rev"]').click()`);
await sleep(1000);
const t0 = Date.now();
await js(`openReplay(${JSON.stringify(rec.id)})`);
const loadMs = Date.now() - t0;
await sleep(2500);
const rev = await js(`({frames: S.replay?.frames.length, units: S.state?.units.length, replay: !!S.state?.replay, map: S.map?.world, moments: S.replay?.moments.length,
  killed: S.replay?.moments.filter(m => m.kind === "killed").length, traces: S.replay?.traces.length, commands: S.replay?.commands.length})`);
check(rev.replay && rev.frames > 0 && rev.units > 0, "real recording opens on the map where the first units appear", `${rev.frames} frames, ${rev.units} units, loaded in ${loadMs} ms`);
check(rev.map === rec.world, "map of the recorded world shown", String(rev.map));
check(rev.moments > 0, "key moments listed", `${rev.moments} moments, ${rev.killed} deaths, ${rev.commands} orders, ${rev.traces} shots`);

// Playback across the whole game at x60, in steps, counting tracers and checking interpolation.
await js(`document.querySelector("#rp-speed").value = "60"; setPlaying(true)`);
const from = await js(`S.replay.t`);
let maxUnits = 0;
for (let i = 0; i < 12; i++) {
  await sleep(250);
  maxUnits = Math.max(maxUnits, await js(`S.state.units.length`));
}
const played = (await js(`S.replay.t`)) - from;
check(played > 100 && maxUnits > 10, "playback at x60 moves through the game", `${Math.round(played)} s played in 3 s, up to ${maxUnits} units`);
await js(`setPlaying(false)`);

// Jump to each death in turn and look at it; the first one is kept as a screenshot.
const deaths = await js(`S.replay.moments.map((m, i) => [m.kind, i]).filter(([k]) => k === "killed").map(([, i]) => i)`);
if (deaths.length) {
  await js(`document.querySelector("#rev-filter").value = "killed"; renderMoments()`);
  await js(`document.querySelector('#momlist [data-i="${deaths[0]}"]').click(); S.view.scale = Math.max(S.view.scale, 2); document.querySelector("#rp-speed").value = "1"; setPlaying(true)`);
  await sleep(2500);
  await js(`setPlaying(false)`);
  const at = await js(`({t: S.replay.t, at: S.replay.moments[${deaths[0]}].t, dead: S.replay.moments[${deaths[0]}].e.data.id})`);
  check(Math.abs(at.t - at.at) < 8, "clicking a death jumps to it", JSON.stringify(at));
  await sleep(300);
  await shot("live-replay-death.png");
}
// A busy stretch: the moment with the most shots around it.
const busy = await js(`(() => { let best = 0, bt = S.replay.start; for (const e of S.replay.traces) { const n = S.replay.traces.filter(x => Math.abs(x.time - e.time) < 5).length; if (n > best) { best = n; bt = e.time; } } return {bt, best}; })()`);
if (busy.best) {
  await js(`seekReplay(${busy.bt} - 1); const p = S.replay.traces.find(x => x.time >= ${busy.bt} - 0.01).data.pos; S.view.cx = p[0]; S.view.cy = p[1]; S.view.scale = 2.5; document.querySelector("#rp-speed").value = "2"; setPlaying(true)`);
  await sleep(1400);
  const s = await js(`S.shots.length`);
  check(s > 0, "shots of a fight replayed as tracers", `${busy.best} shots around ${Math.round(busy.bt)} s, ${s} on screen`);
  await shot("live-replay-fight.png");
  await js(`setPlaying(false)`);
}
await js(`document.querySelector("#rev-filter").value = ""; renderMoments()`);
await js(`document.querySelector("#rp-live").click()`);
await sleep(500);
check(await js(`S.replay === null && (!S.state || !S.state.replay)`), "back to the live game");
check(errors.length === 0, "no JavaScript errors", errors.join(" | "));
await cdp("Browser.close").catch(() => {});
browser.kill();
console.log(failures ? `${failures} check(s) FAILED` : "ALL LIVE REPLAY CHECKS PASSED");
process.exit(failures ? 1 : 0);
