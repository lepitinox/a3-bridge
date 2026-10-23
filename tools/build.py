"""Builds the A3 Bridge mod from the design tables.

Steps: validate the tables -> generate SQF, config, spec and docs -> compile the extension -> pack the mod.
Usage: python tools/build.py [--no-cargo | --ui-only] [--dist <folder>]   (default folder: dist)
--ui-only copies just the web page into the mod folder, which works while the game is running.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pbo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "design"
SRC = ROOT / "src" / "sqf"
UI = ROOT / "src" / "ui" / "index.html"
BUILD = ROOT / "build"
DIST = ROOT / "dist" / "@a3_bridge"
VERSION = "1.0.0"

TABLES = {
    "types": ["name", "kind", "values", "catalog", "sqf_default_type", "description"],
    "commands": ["name", "handler", "returns", "description"],
    "command_params": ["command", "order", "name", "type", "required", "default", "examples", "description"],
    "entities": ["name", "order", "multiple", "source", "description"],
    "state_fields": ["entity", "order", "field", "type", "sqf", "description"],
    "events": ["name", "source", "engine_event", "params", "filter", "client_extra", "description"],
    "event_fields": ["event", "order", "field", "type", "sqf", "description"],
    "settings": ["key", "type", "default", "to_sqf", "description"],
    "effects": ["name", "kind", "class", "altitude", "speed", "description"],
    "catalog_sections": ["name", "order", "source", "description"],
    "catalog_fields": ["section", "order", "field", "sqf", "description"],
}
KINDS = {"number", "string", "boolean", "position", "array", "enum"}
# client_eh: a mission event handler installed on every player's machine, which forwards the raw
# parameters to the server (some events, such as chat, never fire on a dedicated server).
# group_eh: a group event handler, attached to each group when the mod first sees it.
# player_eh: an event handler on each player's own unit, forwarded like client_eh.
EVENT_SOURCES = {"internal", "mission_eh", "unit_eh", "client_eh", "group_eh", "player_eh"}
RELAYED_SOURCES = ("client_eh", "player_eh")
# Engine-provided locals that expressions may use besides the handler's parameters.
MAGIC_LOCALS = {"_x", "_y", "_this", "_forEachIndex"}
EFFECT_KINDS = {"projectile", "smoke", "flare", "mine"}
IDENT = re.compile(r"^[a-z][a-z0-9_]*$")
SQF_LOCAL = re.compile(r"\b_[A-Za-z]\w*")
CORE_FUNCTIONS = sorted(p.stem[3:] for p in (SRC / "core").glob("fn_*.sqf"))
GENERATED_FUNCTIONS = ["init", "state", "attachUnitEvents", "attachGroupEvents", "exportCatalog", "effects", "clientEvent"]


class Problems(list):
    def add(self, table, row, msg):
        self.append(f"{table}[{row}]: {msg}")


def load_tables():
    return {name: json.loads((DESIGN / f"{name}.json").read_text(encoding="utf-8")) for name in TABLES}


def split(cell):
    return [] if cell == "none" else cell.split("|")


def number_range(type_row):
    if type_row["values"] == "none":
        return None
    lo, hi = type_row["values"].split("..")
    return float(lo), float(hi)


def check_value(value, type_row):
    """Returns an error message if a default value does not fit its type, else None."""
    kind = type_row["kind"]
    if kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return "must be a number"
        rng = number_range(type_row)
        if rng and not rng[0] <= value <= rng[1]:
            return f"must be within {type_row['values']}"
    elif kind == "string" and not isinstance(value, str):
        return "must be a string"
    elif kind == "boolean" and not isinstance(value, bool):
        return "must be a boolean"
    elif kind == "position" and not (isinstance(value, list) and len(value) in (2, 3)):
        return "must be [x, y] or [x, y, z]"
    elif kind == "array" and not isinstance(value, list):
        return "must be a list"
    elif kind == "enum" and value not in split(type_row["values"]):
        return f"must be one of {type_row['values']}"
    return None


def check_orders(problems, table, rows, group_key):
    groups = {}
    for i, row in enumerate(rows):
        groups.setdefault(row[group_key], []).append((row["order"], i))
    for key, orders in groups.items():
        got = sorted(o for o, _ in orders)
        if got != list(range(1, len(got) + 1)):
            problems.add(table, orders[0][1], f"orders for {key!r} must be 1..{len(got)}, got {got}")


def validate(t):
    problems = Problems()

    # 1. Shape: every row has exactly the table's columns and no empty cell.
    for name, columns in TABLES.items():
        for i, row in enumerate(t[name]):
            if set(row) != set(columns):
                problems.add(name, i, f"columns {sorted(row)} differ from {columns}")
                continue
            for col in columns:
                v = row[col]
                if v is None or (isinstance(v, str) and not v.strip()):
                    problems.add(name, i, f"empty cell '{col}'")
    if problems:
        return problems

    def unique(table, key_fn, label):
        seen = set()
        for i, row in enumerate(t[table]):
            k = key_fn(row)
            if k in seen:
                problems.add(table, i, f"duplicate {label} {k!r}")
            seen.add(k)

    types = {r["name"]: r for r in t["types"]}
    commands = {r["name"]: r for r in t["commands"]}
    entities = {r["name"]: r for r in t["entities"]}
    events = {r["name"]: r for r in t["events"]}
    settings = {r["key"]: r for r in t["settings"]}

    # 2. Types.
    unique("types", lambda r: r["name"], "type")
    for i, r in enumerate(t["types"]):
        if r["kind"] not in KINDS:
            problems.add("types", i, f"unknown kind {r['kind']!r}")
        if r["kind"] == "enum" and len(split(r["values"])) < 2:
            problems.add("types", i, "enum needs at least two values")
        if r["kind"] == "number" and r["values"] != "none":
            try:
                number_range(r)
            except ValueError:
                problems.add("types", i, f"bad range {r['values']!r}, expected a..b")
        if r["kind"] not in ("enum", "number") and r["values"] != "none":
            problems.add("types", i, "values must be 'none' for this kind")

    # 3. Commands and their parameters.
    unique("commands", lambda r: r["name"], "command")
    unique("command_params", lambda r: (r["command"], r["name"]), "parameter")
    for i, r in enumerate(t["commands"]):
        if not IDENT.match(r["name"]):
            problems.add("commands", i, f"name {r['name']!r} must be snake_case")
        if not (SRC / "commands" / f"{r['handler']}.sqf").is_file():
            problems.add("commands", i, f"handler file src/sqf/commands/{r['handler']}.sqf is missing")
        if not all(IDENT.match(x) for x in split(r["returns"])) or not split(r["returns"]):
            problems.add("commands", i, f"returns {r['returns']!r} must be a | list of snake_case names")
    for i, r in enumerate(t["command_params"]):
        if r["command"] not in commands:
            problems.add("command_params", i, f"unknown command {r['command']!r}")
            continue
        if r["type"] not in types:
            problems.add("command_params", i, f"unknown type {r['type']!r}")
            continue
        if not IDENT.match(r["name"]):
            problems.add("command_params", i, f"name {r['name']!r} must be snake_case")
        if not isinstance(r["required"], bool):
            problems.add("command_params", i, "required must be true or false")
        elif r["required"]:
            if r["default"] != "n/a":
                problems.add("command_params", i, "required parameters take default 'n/a'")
        else:
            err = check_value(r["default"], types[r["type"]])
            if err:
                problems.add("command_params", i, f"default {r['default']!r} {err}")
        if r["examples"] != "none":
            if types[r["type"]]["kind"] != "string":
                problems.add("command_params", i, "examples are only supported for string parameters")
            elif any(not e.strip() for e in split(r["examples"])):
                problems.add("command_params", i, "examples contain an empty entry")
        body = (SRC / "commands" / f"{commands[r['command']]['handler']}.sqf")
        if body.is_file() and not re.search(rf"\b_{r['name']}\b", body.read_text(encoding="utf-8")):
            problems.add("command_params", i, f"handler {body.name} never uses _{r['name']}")
    check_orders(problems, "command_params", t["command_params"], "command")

    # 4. Entities and state fields.
    unique("entities", lambda r: r["name"], "entity")
    unique("state_fields", lambda r: (r["entity"], r["field"]), "field")
    for i, r in enumerate(t["entities"]):
        if not isinstance(r["multiple"], bool):
            problems.add("entities", i, "multiple must be true or false")
        elif (r["source"] == "none") == r["multiple"]:
            problems.add("entities", i, "source must be 'none' exactly when multiple is false")
    check_orders(problems, "entities", [dict(r, _all="all") for r in t["entities"]], "_all")
    for i, r in enumerate(t["state_fields"]):
        if r["entity"] not in entities:
            problems.add("state_fields", i, f"unknown entity {r['entity']!r}")
        if r["type"] not in types:
            problems.add("state_fields", i, f"unknown type {r['type']!r}")
    check_orders(problems, "state_fields", t["state_fields"], "entity")
    for name in entities:
        if not any(r["entity"] == name for r in t["state_fields"]):
            problems.append(f"entities: {name!r} has no field in state_fields")

    # 5. Events and their fields; field expressions may only use the handler's own parameters.
    unique("events", lambda r: r["name"], "event")
    unique("event_fields", lambda r: (r["event"], r["field"]), "field")
    for i, r in enumerate(t["events"]):
        if r["source"] not in EVENT_SOURCES:
            problems.add("events", i, f"unknown source {r['source']!r}")
        internal = r["source"] == "internal"
        if internal != (r["engine_event"] == "none") or internal != (r["params"] == "none"):
            problems.add("events", i, "engine_event and params must be 'none' exactly for internal events")
        if not all(re.match(r"^_[A-Za-z]\w*$", p) for p in split(r["params"])):
            problems.add("events", i, "params must be a | list of _names")
        for local in set(SQF_LOCAL.findall(r["filter"])) - set(split(r["params"])) - MAGIC_LOCALS:
            problems.add("events", i, f"filter uses {local}, which is not a parameter of this event")
        # client_extra: values computed on the player's machine and sent along (as _extra) with relayed events.
        if r["client_extra"] != "none":
            if r["source"] not in RELAYED_SOURCES:
                problems.add("events", i, "client_extra only applies to client_eh and player_eh events")
            for local in set(SQF_LOCAL.findall(r["client_extra"])) - set(split(r["params"])) - MAGIC_LOCALS:
                problems.add("events", i, f"client_extra uses {local}, which is not a parameter of this event")
    for i, r in enumerate(t["event_fields"]):
        if r["event"] not in events:
            problems.add("event_fields", i, f"unknown event {r['event']!r}")
            continue
        if r["type"] not in types:
            problems.add("event_fields", i, f"unknown type {r['type']!r}")
        extra = {"_extra"} if events[r["event"]]["client_extra"] != "none" else set()
        for local in set(SQF_LOCAL.findall(r["sqf"])) - set(split(events[r["event"]]["params"])) - MAGIC_LOCALS - extra:
            problems.add("event_fields", i, f"expression uses {local}, which is not a parameter of {r['event']}")
    check_orders(problems, "event_fields", t["event_fields"], "event")
    for name in events:
        if not any(r["event"] == name for r in t["event_fields"]):
            problems.append(f"events: {name!r} has no field in event_fields")

    # 6. Settings.
    unique("settings", lambda r: r["key"], "setting")
    for i, r in enumerate(t["settings"]):
        if r["type"] not in ("number", "boolean"):
            problems.add("settings", i, "type must be number or boolean")
        elif check_value(r["default"], {"kind": r["type"], "values": "none"}):
            problems.add("settings", i, f"default does not match type {r['type']}")
        if not isinstance(r["to_sqf"], bool):
            problems.add("settings", i, "to_sqf must be true or false")

    # 6b. Catalog: sections, their fields, and the types that pick from them.
    sections = {r["name"]: r for r in t["catalog_sections"]}
    unique("catalog_sections", lambda r: r["name"], "section")
    unique("catalog_fields", lambda r: (r["section"], r["field"]), "field")
    check_orders(problems, "catalog_sections", [dict(r, _all="all") for r in t["catalog_sections"]], "_all")
    for i, r in enumerate(t["catalog_fields"]):
        if r["section"] not in sections:
            problems.add("catalog_fields", i, f"unknown section {r['section']!r}")
        if not IDENT.match(r["field"]):
            problems.add("catalog_fields", i, f"field {r['field']!r} must be snake_case")
    check_orders(problems, "catalog_fields", t["catalog_fields"], "section")
    for name in sections:
        if not any(r["section"] == name for r in t["catalog_fields"]):
            problems.append(f"catalog_sections: {name!r} has no field in catalog_fields")
    for i, r in enumerate(t["types"]):
        if r["catalog"] != "none" and r["catalog"] not in sections:
            problems.add("types", i, f"catalog {r['catalog']!r} is not a catalog section")
        if r["catalog"] != "none" and r["kind"] != "string":
            problems.add("types", i, "only string types can pick from the catalog")

    # 6c. Effects: the effect type must list exactly the effects of the table.
    unique("effects", lambda r: r["name"], "effect")
    for i, r in enumerate(t["effects"]):
        if r["kind"] not in EFFECT_KINDS:
            problems.add("effects", i, f"kind must be one of {sorted(EFFECT_KINDS)}")
        for col in ("altitude", "speed"):
            if isinstance(r[col], bool) or not isinstance(r[col], (int, float)) or r[col] < 0:
                problems.add("effects", i, f"{col} must be a number >= 0")
    effect_type = types.get("effect")
    if not effect_type:
        problems.append("types: the 'effect' type is missing")
    elif set(split(effect_type["values"])) != {r["name"] for r in t["effects"]}:
        problems.append("types: values of 'effect' must match the names in effects.json exactly")

    # 7. Cross references inside SQF: every A3B_fnc_x and A3B_cfg_x must exist.
    functions = set(CORE_FUNCTIONS) | set(GENERATED_FUNCTIONS) | {f"cmd_{c}" for c in commands}
    sqf_settings = {k for k, r in settings.items() if r["to_sqf"] is True}
    sources = [(p.relative_to(ROOT).as_posix(), p.read_text(encoding="utf-8")) for p in SRC.rglob("*.sqf")]
    for table in ("entities", "state_fields", "events", "event_fields", "catalog_sections", "catalog_fields"):
        for i, r in enumerate(t[table]):
            sources.append((f"{table}[{i}]", json.dumps(r)))
    for where, text in sources:
        # Names ending in "_" are prefixes completed at run time (A3B_fnc_cmd_ + command name).
        for fn in set(re.findall(r"A3B_fnc_(\w*[A-Za-z0-9])(?!\w)", text)) - functions:
            problems.append(f"{where}: A3B_fnc_{fn} does not exist")
        for key in set(re.findall(r"A3B_cfg_(\w+)", text)) - sqf_settings:
            problems.append(f"{where}: A3B_cfg_{key} is not a setting with to_sqf = true")

    # 8. The web UI's shortcuts must name real commands and parameters.
    params_of = {c: {p["name"] for p in t["command_params"] if p["command"] == c} for c in commands}
    ui = UI.read_text(encoding="utf-8")
    for cmd, body in re.findall(r'cmd:\s*"(\w+)",\s*args:\s*\{([^}]*)\}', ui):
        if cmd not in commands:
            problems.append(f"src/ui/index.html: shortcut uses unknown command {cmd!r}")
            continue
        for arg in re.findall(r"(\w+)\s*:", body):
            if arg not in params_of[cmd]:
                problems.append(f"src/ui/index.html: shortcut passes unknown parameter {arg!r} to {cmd}")
    return problems


# ---------------------------------------------------------------- generation

HEADER = "/* Generated by tools/build.py from the design tables: do not edit. */\n"


def by_order(rows, key=None, value=None):
    return sorted((r for r in rows if key is None or r[key] == value), key=lambda r: r["order"])


def sqf_string(s):
    return '"' + s.replace('"', '""') + '"'


def gen_state(t):
    parts = []
    for ent in by_order(t["entities"]):
        exprs = ", ".join(f"({f['sqf']})" for f in by_order(t["state_fields"], "entity", ent["name"]))
        if ent["multiple"]:
            parts.append(f"    // {ent['name']}\n    ({ent['source']}) apply {{[{exprs}]}}")
        else:
            parts.append(f"    // {ent['name']}\n    [{exprs}]")
    return HEADER + "[\n" + ",\n".join(parts) + "\n]\n"


def event_push(ev, fields):
    exprs = ", ".join(f"({f['sqf']})" for f in fields)
    return f"A3B_events pushBack [{sqf_string(ev['name'])}, time, [{exprs}]]"


def event_params(ev):
    return "params [" + ", ".join(sqf_string(p) for p in split(ev["params"])) + "];"


def relay_extra(ev):
    """SQF sent along with a relayed event: its client_extra values, computed on the player's machine."""
    return "[]" if ev["client_extra"] == "none" else ev["client_extra"]


def gen_init(t):
    template = (SRC / "init.template.sqf").read_text(encoding="utf-8")
    to_sqf = [s for s in t["settings"] if s["to_sqf"]]
    settings = "\n".join(f"A3B_cfg_{s['key']} = _cfg select {i};" for i, s in enumerate(to_sqf))
    blocks = []
    for ev in t["events"]:
        fields = by_order(t["event_fields"], "event", ev["name"])
        if ev["source"] == "mission_eh":
            blocks.append(
                f"// {ev['name']}: {ev['description']}\n"
                f"addMissionEventHandler [{sqf_string(ev['engine_event'])}, {{\n"
                f"    {event_params(ev)}\n"
                f"    if ({ev['filter']}) then {{{event_push(ev, fields)}}};\n"
                # Some handlers act on their return value (HandleChatMessage hides the message on true).
                f"    false\n"
                f"}}];"
            )
        if ev["source"] == "client_eh":
            # Installed on every machine with a player (and later joiners, through the JIP queue);
            # the filter runs there, the fields are computed by the server in A3B_fnc_clientEvent.
            hook = f"A3B_clientEH_{ev['name']}"
            blocks.append(
                f"// {ev['name']}: {ev['description']}\n"
                f"[{{\n"
                f"    if (!hasInterface) exitWith {{}};\n"
                f"    if (!isNil {sqf_string(hook)}) then {{removeMissionEventHandler [{sqf_string(ev['engine_event'])}, {hook}]}};\n"
                f"    {hook} = addMissionEventHandler [{sqf_string(ev['engine_event'])}, {{\n"
                f"        {event_params(ev)}\n"
                f"        if ({ev['filter']}) then {{[{sqf_string(ev['name'])}, _this, {relay_extra(ev)}] remoteExecCall [\"A3B_fnc_clientEvent\", 2]}};\n"
                f"        false\n"
                f"    }}];\n"
                f"}}] remoteExec [\"call\", 0, {sqf_string(hook)}];"
            )
        if ev["source"] == "player_eh":
            # Attached to each player's own unit once it exists (unit handlers carry over on respawn).
            hook = f"A3B_playerEH_{ev['name']}"
            blocks.append(
                f"// {ev['name']}: {ev['description']}\n"
                f"[{{\n"
                f"    if (!hasInterface) exitWith {{}};\n"
                f"    [] spawn {{\n"
                f"        waitUntil {{sleep 0.5; !isNull player}};\n"
                f"        if (!isNil {sqf_string(hook)}) exitWith {{}};\n"
                f"        {hook} = player addEventHandler [{sqf_string(ev['engine_event'])}, {{\n"
                f"            {event_params(ev)}\n"
                f"            if ({ev['filter']}) then {{[{sqf_string(ev['name'])}, _this, {relay_extra(ev)}] remoteExecCall [\"A3B_fnc_clientEvent\", 2]}};\n"
                f"        }}];\n"
                f"    }};\n"
                f"}}] remoteExec [\"call\", 0, {sqf_string(hook)}];"
            )
    for ev in t["events"]:
        if ev["source"] == "internal":
            blocks.append(f"// {ev['name']}: {ev['description']}\n{event_push(ev, by_order(t['event_fields'], 'event', ev['name']))};")
    text = template.replace("//@SETTINGS@", settings).replace("//@EVENTS@", "\n\n".join(blocks))
    return HEADER + text


def gen_client_event(t):
    """Server side of client_eh events: turns the raw parameters sent by a player's machine into an event."""
    cases = []
    for ev in t["events"]:
        if ev["source"] in RELAYED_SOURCES:
            fields = by_order(t["event_fields"], "event", ev["name"])
            names = ", ".join(sqf_string(p) for p in split(ev["params"]))
            cases.append(
                f"    case {sqf_string(ev['name'])}: {{\n"
                f"        _args params [{names}];\n"
                f"        {event_push(ev, fields)};\n"
                f"    }};"
            )
    return (
        HEADER
        + "/* Receives client_eh events from players' machines: [event name, the handler's parameters]. */\n"
        + "params [\"_event\", \"_args\", [\"_extra\", []]];\n"
        + "switch (_event) do {\n" + "\n".join(cases) + "\n};\n"
    )


def gen_attach(t, source="unit_eh"):
    """Event handlers added to each unit (unit_eh) or group (group_eh) when the mod first sees it."""
    blocks = []
    for ev in t["events"]:
        if ev["source"] == source:
            fields = by_order(t["event_fields"], "event", ev["name"])
            blocks.append(
                f"// {ev['name']}: {ev['description']}\n"
                f"_this addEventHandler [{sqf_string(ev['engine_event'])}, {{\n"
                f"    {event_params(ev)}\n"
                f"    if ({ev['filter']}) then {{{event_push(ev, fields)}}};\n"
                f"}}];"
            )
    return HEADER + "\n\n".join(blocks) + "\n"


def gen_command(t, cmd, types):
    params = []
    for p in by_order(t["command_params"], "command", cmd["name"]):
        ty = types[p["type"]]
        spec = f'["_{p["name"]}", {ty["sqf_default_type"]}, [{ty["sqf_default_type"]}]'
        if ty["kind"] == "position":
            spec += ", [3]"
        params.append(spec + "]")
    body = (SRC / "commands" / f"{cmd['handler']}.sqf").read_text(encoding="utf-8")
    return (
        HEADER
        + f"/* {cmd['name']}: {cmd['description']} */\n"
        + "params [" + ", ".join(params) + "];\n"
        + body
    )


def gen_catalog(t):
    """Scheduled script reading the game's configs into the catalog, 25 rows (a few KB) per piece."""
    blocks = []
    for sec in by_order(t["catalog_sections"]):
        exprs = ", ".join(f"({f['sqf']})" for f in by_order(t["catalog_fields"], "section", sec["name"]))
        name = sqf_string(sec["name"])
        blocks.append(
            f"// {sec['name']}: {sec['description']}\n"
            f"_rows = [];\n"
            f"{{\n"
            f"    _rows pushBack [{exprs}];\n"
            f"    if (count _rows >= 25) then {{\"a3_bridge\" callExtension [\"catalog_add\", [{name}, str _rows]]; _rows = []}};\n"
            f"}} forEach ({sec['source']});\n"
            f"if (_rows isNotEqualTo []) then {{\"a3_bridge\" callExtension [\"catalog_add\", [{name}, str _rows]]}};"
        )
    return (
        HEADER
        + "/* Reads the game's configs (classes, groups, markers) into the catalog served at GET /catalog. */\n"
        + "private _t0 = diag_tickTime;\n"
        + "private _rows = [];\n"
        + "\"a3_bridge\" callExtension [\"catalog_begin\", []];\n\n"
        + "\n\n".join(blocks)
        + "\n\n\"a3_bridge\" callExtension [\"catalog_commit\", []];\n"
        + "diag_log format [\"[a3_bridge] catalog read in %1 s\", (round ((diag_tickTime - _t0) * 10)) / 10];\n"
    )


def gen_effects(t):
    rows = ",\n    ".join(
        f"[{sqf_string(e['name'])}, [{sqf_string(e['kind'])}, {sqf_string(e['class'])}, {e['altitude']}, {e['speed']}]]"
        for e in t["effects"]
    )
    return HEADER + "/* Effect name -> [kind, class, altitude, speed], from design/effects.json. */\ncreateHashMapFromArray [\n    " + rows + "\n]\n"


def gen_config(t):
    names = (["init"] + [f for f in CORE_FUNCTIONS] + ["state", "attachUnitEvents", "attachGroupEvents", "exportCatalog", "effects", "clientEvent"]
             + [f"cmd_{c['name']}" for c in t["commands"]])
    classes = "\n".join(
        f"            class {n} {{postInit = 1;}};" if n == "init" else f"            class {n} {{}};" for n in names
    )
    return f"""{HEADER}class CfgPatches {{
    class a3_bridge {{
        name = "A3 Bridge";
        author = "A3 Bridge";
        version = "{VERSION}";
        units[] = {{}};
        weapons[] = {{}};
        requiredVersion = 2.18;
        requiredAddons[] = {{"A3_Functions_F"}};
    }};
}};

class CfgFunctions {{
    class A3B {{
        class core {{
            file = "\\a3_bridge\\functions";
{classes}
        }};
    }};
}};
"""


def gen_spec(t):
    types = {r["name"]: r for r in t["types"]}
    return {
        "version": VERSION,
        "types": {
            r["name"]: {"kind": r["kind"], "values": split(r["values"]) if r["kind"] == "enum" else None,
                        "range": number_range(r) if r["kind"] == "number" else None,
                        "catalog": None if r["catalog"] == "none" else r["catalog"], "description": r["description"]}
            for r in t["types"]
        },
        "catalog": [
            {"name": s["name"], "description": s["description"],
             "fields": [f["field"] for f in by_order(t["catalog_fields"], "section", s["name"])]}
            for s in by_order(t["catalog_sections"])
        ],
        "effects": [{"name": e["name"], "kind": e["kind"], "description": e["description"]} for e in t["effects"]],
        "commands": [
            {
                "name": c["name"],
                "description": c["description"],
                "returns": split(c["returns"]),
                "params": [
                    {"name": p["name"], "type": p["type"], "kind": types[p["type"]]["kind"], "required": p["required"],
                     "default": None if p["required"] else p["default"], "description": p["description"]}
                    for p in by_order(t["command_params"], "command", c["name"])
                ],
            }
            for c in t["commands"]
        ],
        "entities": [
            {"name": e["name"], "multiple": e["multiple"],
             "fields": [f["field"] for f in by_order(t["state_fields"], "entity", e["name"])]}
            for e in by_order(t["entities"])
        ],
        "events": [
            {"name": e["name"], "fields": [f["field"] for f in by_order(t["event_fields"], "event", e["name"])]}
            for e in t["events"]
        ],
        "settings": [{"key": s["key"], "type": s["type"], "default": s["default"], "to_sqf": s["to_sqf"]} for s in t["settings"]],
    }


def json_schema(p, types):
    ty = types[p["type"]]
    kind = ty["kind"]
    if kind == "number":
        s = {"type": "number"}
        rng = number_range(ty)
        if rng:
            s.update(minimum=rng[0], maximum=rng[1])
    elif kind == "string":
        s = {"type": "string"}
    elif kind == "boolean":
        s = {"type": "boolean"}
    elif kind == "position":
        s = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 3}
    elif kind == "array":
        s = {"type": "array"}
    else:
        s = {"type": "string", "enum": split(ty["values"])}
    # The title carries the design type (entity_id, classname, code...) so clients can pick a widget.
    s["title"] = p["type"]
    s["description"] = f"{p['description']} ({ty['description']})"
    if not p["required"]:
        s["default"] = p["default"]
    if p["examples"] != "none":
        s["examples"] = split(p["examples"])
    return s


def gen_tools(t):
    types = {r["name"]: r for r in t["types"]}
    tools = []
    for c in t["commands"]:
        params = by_order(t["command_params"], "command", c["name"])
        tools.append({
            "name": f"arma_{c['name']}",
            "description": f"{c['description']} Renvoie : {', '.join(split(c['returns']))}.",
            "input_schema": {
                "type": "object",
                "properties": {p["name"]: json_schema(p, types) for p in params},
                "required": [p["name"] for p in params if p["required"]],
                "additionalProperties": False,
            },
        })
    return tools


def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c).replace("|", "\\|") for c in row) + " |" for row in rows]
    return "\n".join(out)


def gen_protocol(t):
    types = {r["name"]: r for r in t["types"]}
    s = [f"# A3 Bridge {VERSION} : protocole\n",
         "_Généré depuis les tableaux de `design/` par `tools/build.py`._\n",
         "Passerelle locale : `http://127.0.0.1:8765` et `ws://127.0.0.1:8765` (port réglable).\n",
         "## Ordres\n",
         "Chaque ordre s'envoie en `POST /command` avec `{\"cmd\": \"<nom>\", \"args\": {...}}`, ou en WebSocket avec "
         "`{\"type\": \"command\", \"id\": <votre id>, \"cmd\": \"<nom>\", \"args\": {...}}`.\n"]
    for c in t["commands"]:
        s.append(f"### `{c['name']}`\n\n{c['description']}\n\nRenvoie : `{'`, `'.join(split(c['returns']))}`\n")
        rows = [(f"`{p['name']}`", p["type"], "oui" if p["required"] else f"non (défaut `{json.dumps(p['default'], ensure_ascii=False)}`)",
                 p["description"] + ("" if p["examples"] == "none" else " Exemples : " + ", ".join(f"`{e}`" for e in split(p["examples"]))))
                for p in by_order(t["command_params"], "command", c["name"])]
        s.append(md_table(["Paramètre", "Type", "Obligatoire", "Description"], rows) + "\n")
    s.append("## Types\n")
    s.append(md_table(["Type", "Nature", "Valeurs", "Description"],
                      [(f"`{r['name']}`", r["kind"], r["values"], r["description"]) for r in t["types"]]) + "\n")
    s.append("## Flux d'état\n\nMessage `{\"type\": \"state\", \"seq\": n, \"world\": {...}, \"units\": [...], ...}` "
             "toutes les `state_interval_ms` millisecondes ; aussi disponible en `GET /state`.\n")
    for e in by_order(t["entities"]):
        s.append(f"### `{e['name']}`\n\n{e['description']}\n")
        s.append(md_table(["Champ", "Type", "Description"],
                          [(f"`{f['field']}`", f["type"], f["description"]) for f in by_order(t["state_fields"], "entity", e["name"])]) + "\n")
    s.append("## Événements\n\nMessage `{\"type\": \"event\", \"seq\": n, \"event\": \"<nom>\", \"time\": t, \"data\": {...}}` ; "
             "historique en `GET /events?since=<seq>`.\n")
    for e in t["events"]:
        s.append(f"### `{e['name']}`\n\n{e['description']}\n")
        s.append(md_table(["Champ", "Type", "Description"],
                          [(f"`{f['field']}`", f["type"], f["description"]) for f in by_order(t["event_fields"], "event", e["name"])]) + "\n")
    s.append("## Effets (`spawn_effect`)\n")
    s.append(md_table(["Effet", "Nature", "Classe", "Description"],
                      [(f"`{e['name']}`", e["kind"], f"`{e['class']}`", e["description"]) for e in t["effects"]]) + "\n")
    s.append("## Catalogue (`GET /catalog`)\n\nLu dans la configuration du jeu au démarrage de chaque partie (DLC et mods compris). "
             "Réponse : `{\"sections\": {\"<section>\": {\"fields\": [...], \"rows\": [[...], ...]}}}` ; "
             "le premier champ de chaque section est la valeur à passer à l'ordre correspondant.\n")
    for sec in by_order(t["catalog_sections"]):
        s.append(f"### `{sec['name']}`\n\n{sec['description']}\n")
        s.append(md_table(["Champ", "Description"],
                          [(f"`{f['field']}`", f["description"]) for f in by_order(t["catalog_fields"], "section", sec["name"])]) + "\n")
    s.append("## Réglages\n\nÀ placer dans `a3_bridge.json`, à côté de `a3_bridge_x64.dll`.\n")
    s.append(md_table(["Clé", "Défaut", "Description"],
                      [(f"`{r['key']}`", json.dumps(r["default"]), r["description"]) for r in t["settings"]]) + "\n")
    return "\n".join(s)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def generate(t):
    types = {r["name"]: r for r in t["types"]}
    addon = BUILD / "addon"
    if addon.exists():
        shutil.rmtree(addon)
    write(addon / "config.cpp", gen_config(t))
    fdir = addon / "functions"
    for name in CORE_FUNCTIONS:
        write(fdir / f"fn_{name}.sqf", (SRC / "core" / f"fn_{name}.sqf").read_text(encoding="utf-8"))
    write(fdir / "fn_init.sqf", gen_init(t))
    write(fdir / "fn_state.sqf", gen_state(t))
    write(fdir / "fn_attachUnitEvents.sqf", gen_attach(t, "unit_eh"))
    write(fdir / "fn_attachGroupEvents.sqf", gen_attach(t, "group_eh"))
    write(fdir / "fn_exportCatalog.sqf", gen_catalog(t))
    write(fdir / "fn_effects.sqf", gen_effects(t))
    write(fdir / "fn_clientEvent.sqf", gen_client_event(t))
    for c in t["commands"]:
        write(fdir / f"fn_cmd_{c['name']}.sqf", gen_command(t, c, types))
    tools = gen_tools(t)
    write(BUILD / "spec.json", json.dumps(gen_spec(t), indent=1, ensure_ascii=False))
    write(BUILD / "tools.json", json.dumps(tools, indent=1, ensure_ascii=False))
    write(ROOT / "docs" / "PROTOCOL.md", gen_protocol(t))
    write(ROOT / "docs" / "llm_tools.json", json.dumps(tools, indent=2, ensure_ascii=False))


def cargo_build():
    cargo = shutil.which("cargo") or str(Path.home() / ".cargo" / "bin" / "cargo.exe")
    subprocess.run([cargo, "build", "--release"], cwd=ROOT / "ext", check=True)
    return ROOT / "ext" / "target" / "release" / "a3_bridge.dll"


def copy_ui(dist):
    """The mod serves ui/index.html from its folder, so the page can change while the game runs."""
    (dist / "ui").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(UI, dist / "ui" / "index.html")


def package(t, dll, dist):
    # A running game or server keeps the DLL locked; check before deleting anything.
    if (dist / "a3_bridge_x64.dll").exists():
        try:
            with open(dist / "a3_bridge_x64.dll", "r+b"):
                pass
        except PermissionError:
            sys.exit(f"{dist} is in use by a running game or server: stop it, or build elsewhere with --dist <folder>")
    if dist.exists():
        shutil.rmtree(dist)
    (dist / "addons").mkdir(parents=True)
    files = {p.relative_to(BUILD / "addon").as_posix().replace("/", "\\"): p.read_bytes()
             for p in sorted((BUILD / "addon").rglob("*")) if p.is_file()}
    pbo.write_pbo(dist / "addons" / "a3_bridge.pbo", files, {"prefix": "a3_bridge", "version": VERSION})
    shutil.copyfile(dll, dist / "a3_bridge_x64.dll")
    write(dist / "mod.cpp", 'name = "A3 Bridge";\n'
          'tooltip = "Pilotage externe du scénario (HTTP / WebSocket local)";\n'
          'overview = "Expose l\'état du scénario et accepte des ordres depuis un programme local (127.0.0.1).";\n')
    write(dist / "a3_bridge.example.json",
          json.dumps({s["key"]: s["default"] for s in t["settings"]}, indent=2))
    copy_ui(dist)
    shutil.copyfile(ROOT / "docs" / "PROTOCOL.md", dist / "PROTOCOL.md")
    shutil.copyfile(ROOT / "docs" / "llm_tools.json", dist / "llm_tools.json")


def main():
    t = load_tables()
    problems = validate(t)
    if problems:
        print(f"Design check FAILED ({len(problems)} problem(s)):")
        for p in problems:
            print("  - " + p)
        sys.exit(1)
    counts = ", ".join(f"{len(rows)} {name}" for name, rows in t.items())
    print(f"Design check OK: {counts}")
    generate(t)
    print("Generated SQF, config, spec and docs")
    dist = Path(sys.argv[sys.argv.index("--dist") + 1]).resolve() / "@a3_bridge" if "--dist" in sys.argv else DIST
    if "--ui-only" in sys.argv:
        # Only the web page: safe while a game or server holds the DLL; reload the browser to see it.
        copy_ui(dist)
        print(f"Updated the web page in {dist / 'ui'}")
        return
    if "--no-cargo" in sys.argv:
        return
    dll = cargo_build()
    package(t, dll, dist)
    print(f"Packed mod in {dist}")


if __name__ == "__main__":
    main()
