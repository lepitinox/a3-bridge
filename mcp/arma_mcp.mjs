#!/usr/bin/env node
// MCP server (stdio, JSON-RPC 2.0) exposing the A3 Bridge gateway to an LLM client such as Claude.
// Every game command becomes a tool (from GET /schema, generated from the design tables), plus
// read tools: situation, events, player chat (with waiting) and catalog search.
//   node mcp/arma_mcp.mjs            (gateway at http://127.0.0.1:8765, or A3B_URL)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const BASE = process.env.A3B_URL ?? "http://127.0.0.1:8765";
const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "1.0.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INSTRUCTIONS = `Ces outils pilotent une partie d'Arma 3 en cours via le mod A3 Bridge.
- Commencez par arma_get_situation pour voir la carte, les unités, les groupes et les marqueurs ; les identifiants (u12 soldat, v3 véhicule, g4 groupe, o7 objet) servent ensuite dans les ordres.
- Positions en mètres [x, y] (z = hauteur au-dessus du sol). x croît vers l'est, y vers le nord.
- Les outils arma_query_* ne changent rien au jeu : utilisez-les pour raisonner (terrain, visibilité, couverture face à une menace, ennemis connus, état d'un groupe).
- Pour suivre la bataille sans tout redemander, arma_wait_for_events attend les événements (ennemi repéré, unité touchée, point de passage atteint, passage en combat, fuite, tirs...).
- Pour trouver une classe (soldat, véhicule, objet, groupe, arme), utilisez arma_find_in_catalog.
- Pour dialoguer avec les joueurs : arma_wait_for_chat attend leurs messages, arma_message (kind side_chat ou subtitle, sender = votre nom) leur répond.
- arma_exec_sqf exécute du code libre : à n'utiliser qu'en dernier recours.`;

// ------------------------------------------------------------------ gateway

async function get(path) {
  const r = await fetch(BASE + path);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error?.message ?? `HTTP ${r.status} on ${path}`);
  return body;
}

async function command(cmd, args) {
  const r = await fetch(`${BASE}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, args, source: "mcp" }) });
  return r.json();
}

// ------------------------------------------------------------------ tools

let gameTools = null;

/** Game commands as MCP tools, from the live gateway or, when the game is not running, from the generated file. */
async function loadGameTools() {
  if (gameTools) return gameTools;
  let tools;
  try {
    tools = (await get("/schema")).tools;
  } catch {
    // docs/ in the repository; @a3_bridge/ next to mcp/ in the downloadable zip.
    const files = [join(HERE, "..", "docs", "llm_tools.json"), join(HERE, "..", "@a3_bridge", "llm_tools.json")];
    tools = JSON.parse(readFileSync(files.find((f) => existsSync(f)) ?? files[0], "utf8"));
  }
  gameTools = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, cmd: t.name.replace(/^arma_/, "") }));
  return gameTools;
}

const round = (p) => (Array.isArray(p) ? p.map((v) => Math.round(v)) : p);
const flat = (e) => ({ seq: e.seq, event: e.event, time: Math.round(e.time ?? 0), ...e.data });

/** Waits until events of the given types arrive after `since` (or only future ones), up to timeout_s. */
async function waitForEvents(types, since, timeoutS) {
  let from = since ?? (await get("/events?since=0&limit=1")).last_seq;
  const deadline = Date.now() + Math.min(120, timeoutS ?? 30) * 1000;
  for (;;) {
    const ev = await get(`/events?since=${from}&limit=5000`);
    const hits = ev.events.filter((e) => !types?.length || types.includes(e.event));
    if (hits.length || Date.now() >= deadline) return { events: hits.map(flat), last_seq: ev.last_seq, timed_out: hits.length === 0 };
    from = ev.last_seq;
    await sleep(500);
  }
}
const near = (pos, area) => !area || Math.hypot(pos[0] - area.pos[0], pos[1] - area.pos[1]) <= (area.radius ?? 1000);

const READ_TOOLS = [
  {
    name: "arma_get_situation",
    description: "Situation actuelle : carte, heure, météo, puis unités, véhicules, groupes, objets et marqueurs (positions arrondies au mètre). Filtrable par zone et par camp pour rester concis.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "object", description: "Ne garder que ce qui est dans un cercle.", properties: { pos: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 3 }, radius: { type: "number", default: 1000 } }, required: ["pos"] },
        side: { type: "string", enum: ["all", "west", "east", "independent", "civilian"], default: "all" },
        include: { type: "array", items: { type: "string", enum: ["units", "vehicles", "groups", "objects", "markers"] }, default: ["units", "vehicles", "groups", "markers"] },
        include_dead: { type: "boolean", default: false },
        max: { type: "number", default: 150, description: "Nombre maximal d'éléments par liste." },
      },
      additionalProperties: false,
    },
    async run(a) {
      const st = await get("/state");
      const side = a.side ?? "all";
      const include = a.include ?? ["units", "vehicles", "groups", "markers"];
      const max = a.max ?? 150;
      const posOf = Object.fromEntries((st.units ?? []).map((u) => [u.id, u.pos]));
      const out = { world: st.world };
      const take = (list) => list.slice(0, max);
      if (include.includes("units")) out.units = take(st.units.filter((u) => (a.include_dead || u.alive) && (side === "all" || u.side === side) && near(u.pos, a.area))
        .map((u) => ({ id: u.id, type: u.type, name: u.name, side: u.side, group: u.group, pos: round(u.pos), health: u.health, alive: u.alive, vehicle: u.vehicle || undefined, player: u.is_player || undefined })));
      if (include.includes("vehicles")) out.vehicles = take(st.vehicles.filter((v) => (a.include_dead || v.alive) && (side === "all" || v.side === side) && near(v.pos, a.area))
        .map((v) => ({ id: v.id, type: v.type, side: v.side, pos: round(v.pos), health: v.health, fuel: v.fuel, crew: v.crew })));
      if (include.includes("groups")) out.groups = take(st.groups.filter((g) => (side === "all" || g.side === side) && near(posOf[g.leader] ?? [0, 0], a.area))
        .map((g) => ({ id: g.id, name: g.name, side: g.side, leader: g.leader, size: g.units.length, behaviour: g.behaviour, combat_mode: g.combat_mode, destination: round(g.destination) })));
      if (include.includes("objects")) out.objects = take(st.objects.filter((o) => near(o.pos, a.area)).map((o) => ({ id: o.id, type: o.type, pos: round(o.pos) })));
      if (include.includes("markers")) out.markers = take((st.markers ?? []).filter((m) => near(m.pos, a.area)).map((m) => ({ name: m.name, text: m.text, type: m.type, color: m.color, shape: m.shape, pos: round(m.pos) })));
      return out;
    },
  },
  {
    name: "arma_get_events",
    description: "Événements récents (tués, créés, supprimés, tirs, joueurs, chat) après un numéro de séquence. Gardez last_seq pour l'appel suivant.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "number", default: 0 },
        types: { type: "array", items: { type: "string" }, description: "Ne garder que ces événements (killed, created, deleted, fired, chat, player_connected...)." },
        limit: { type: "number", default: 100 },
      },
      additionalProperties: false,
    },
    async run(a) {
      const ev = await get(`/events?since=${a.since ?? 0}&limit=5000`);
      const list = ev.events.filter((e) => !a.types || a.types.includes(e.event));
      return { events: list.slice(-(a.limit ?? 100)).map(flat), last_seq: ev.last_seq };
    },
  },
  {
    name: "arma_wait_for_chat",
    description: "Attend qu'un joueur écrive dans le chat du jeu (jusqu'à timeout_s secondes) et renvoie les nouveaux messages avec last_seq. Pour dialoguer : appelez-le en boucle avec since = last_seq, et répondez avec arma_message.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "number", description: "Dernier numéro de séquence déjà lu ; absent = seulement les messages à venir." },
        timeout_s: { type: "number", default: 30, minimum: 1, maximum: 120 },
      },
      additionalProperties: false,
    },
    async run(a) {
      const r = await waitForEvents(["chat"], a.since, a.timeout_s);
      return { messages: r.events.map(({ event, ...m }) => m), last_seq: r.last_seq, timed_out: r.timed_out };
    },
  },
  {
    name: "arma_wait_for_events",
    description: "Attend que des événements arrivent (jusqu'à timeout_s secondes) et les renvoie avec last_seq : par exemple enemy_detected (un groupe repère un ennemi), hit (une unité est touchée), killed, waypoint_completed, combat_changed, group_fleeing, fired, player_fired, chat. Pour suivre la bataille : appelez-le en boucle avec since = last_seq.",
    inputSchema: {
      type: "object",
      properties: {
        types: { type: "array", items: { type: "string" }, description: "Types d'événements attendus ; vide = tous." },
        since: { type: "number", description: "Dernier numéro de séquence déjà lu ; absent = seulement les événements à venir." },
        timeout_s: { type: "number", default: 30, minimum: 1, maximum: 120 },
        limit: { type: "number", default: 100 },
      },
      additionalProperties: false,
    },
    async run(a) {
      const r = await waitForEvents(a.types, a.since, a.timeout_s);
      return { ...r, events: r.events.slice(-(a.limit ?? 100)) };
    },
  },
  {
    name: "arma_find_in_catalog",
    description: "Cherche dans le catalogue du jeu (DLC et mods compris) : soldats (units), véhicules, objets, groupes, armes, chargeurs (magazines), équipements (gear), sacs (backpacks), icônes et couleurs de marqueurs. La première colonne est la valeur à passer aux ordres.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["units", "vehicles", "objects", "groups", "weapons", "magazines", "gear", "backpacks", "marker_types", "marker_colors"] },
        search: { type: "string", description: "Mots à chercher (nom, classe, faction, catégorie), tous requis ; vide = tout." },
        limit: { type: "number", default: 25 },
      },
      required: ["section"],
      additionalProperties: false,
    },
    async run(a) {
      const sec = (await get("/catalog")).sections[a.section];
      if (!sec) throw new Error(`unknown section ${a.section}`);
      const words = (a.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const rows = sec.rows.filter((r) => words.every((w) => r.join(" ").toLowerCase().includes(w)));
      return { fields: sec.fields, total: rows.length, rows: rows.slice(0, a.limit ?? 25) };
    },
  },
  {
    name: "arma_status",
    description: "État de la passerelle : jeu connecté, scénario, carte, catalogue.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const h = await get("/health");
      return { game_connected: h.game_connected, mission: h.mission, map: h.map, catalog: h.catalog, queued_commands: h.queued_commands };
    },
  },
];

const PROMPTS = [
  {
    name: "commandant_ia",
    description: "Jouer le commandant IA qui répond aux joueurs dans le chat et dirige les forces d'un camp.",
    arguments: [{ name: "side", description: "Camp commandé (west, east, independent).", required: false }],
    text: (args) => `Tu es le commandant IA du camp ${args.side ?? "west"} dans une partie d'Arma 3.
1. Fais le point avec arma_status puis arma_get_situation (side = ${args.side ?? "west"}).
2. Appelle arma_wait_for_chat en boucle (since = last_seq précédent). Pour chaque message d'un joueur :
   - comprends la demande, vérifie le terrain et les forces avec les outils arma_query_* et arma_get_situation ;
   - agis avec les ordres (spawn_group, add_waypoint, defend, attack, artillery_fire, spawn_effect, set_marker...) ;
   - réponds au joueur avec arma_message (kind = side_chat, to = son camp, sender = "Commandant IA"), en une ou deux phrases.
3. Reste crédible militairement et n'exécute pas de code libre sauf demande explicite.`,
  },
];

// ------------------------------------------------------------------ JSON-RPC over stdio

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const asText = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], isError });

async function handle(msg) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "a3-bridge", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply(id, {});
    case "tools/list": {
      const tools = [...READ_TOOLS, ...(await loadGameTools())].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      return reply(id, { tools });
    }
    case "tools/call": {
      const name = params.name;
      const args = params.arguments ?? {};
      try {
        const read = READ_TOOLS.find((t) => t.name === name);
        if (read) return reply(id, asText(await read.run(args)));
        const game = (await loadGameTools()).find((t) => t.name === name);
        if (!game) return reply(id, asText(`outil inconnu : ${name}`, true));
        const r = await command(game.cmd, args);
        return reply(id, r.ok ? asText(r.result) : asText(`${r.error.code} : ${r.error.message}`, true));
      } catch (e) {
        return reply(id, asText(`passerelle injoignable ou erreur : ${e.message}. Le jeu tourne-t-il avec le mod A3 Bridge ?`, true));
      }
    }
    case "prompts/list":
      return reply(id, { prompts: PROMPTS.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })) });
    case "prompts/get": {
      const p = PROMPTS.find((x) => x.name === params.name);
      if (!p) return fail(id, -32602, `unknown prompt ${params.name}`);
      return reply(id, { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(params.arguments ?? {}) } }] });
    }
    default:
      if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "parse error");
  }
  handle(msg).catch((e) => msg.id !== undefined && fail(msg.id, -32603, e.message));
});
