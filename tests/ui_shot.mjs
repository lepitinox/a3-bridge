// Read-only screenshots of the web page against a live game: sends no command.
//   node tests/ui_shot.mjs <port> <browser.exe> <screenshot dir> [x y scale name]...
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [port, exe, shots, ...views] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "a3b-shot-"));
const browser = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=9334", "--window-size=1500,900", "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = await (await fetch(`http://127.0.0.1:9334/json/new?http://127.0.0.1:${port}/ui`, { method: "PUT" })).json(); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { waiting.get(msg.id)?.(msg); waiting.delete(msg.id); } };
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

await cdp("Page.reload");
// WORLD=<name> shows another cached world's map (to check rendering against real data offline).
if (process.env.WORLD) {
  await sleep(500);
  await js(`(() => { const original = onState; onState = (st) => { st.world.world = ${JSON.stringify(process.env.WORLD)}; original(st); }; })()`);
}
for (let i = 0; i < 40 && !(await js(`S.map?.world === (${JSON.stringify(process.env.WORLD ?? "")} || S.map?.world) && !!S.map?.img`)); i++) await sleep(500);
console.log("terrain built in", await js(`S.terrainMs`), "ms");
console.log("map:", await js(`document.querySelector("#mapstatus").textContent`));
for (let i = 0; i + 3 < views.length; i += 4) {
  const [x, y, scale, name] = views.slice(i, i + 4);
  await js(`(() => { S.view.cx = ${Number(x)}; S.view.cy = ${Number(y)}; S.view.scale = ${Number(scale)}; S.dirty = true; })()`);
  await sleep(600);
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, name), Buffer.from(r.result.data, "base64"));
  console.log("saved", name);
}
await cdp("Browser.close").catch(() => {});
browser.kill();
