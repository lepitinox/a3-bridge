"""Offline test: loads a3_bridge_x64.dll the way Arma does and plays a fake scenario,
then runs tests/client_test.mjs against the gateway.

Usage: python -I tests/fake_game.py
"""
import ctypes
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT / "build" / "spec.json").read_text(encoding="utf-8"))
OUTPUT_SIZE = 10240  # what the engine hands to extensions
PORT = 8799
CHUNK = 4000
# A made-up world name, so the fake map never replaces a real world's cached map.
WORLD = "FakeIsland"
SIZE = 8192


FAKE_CATALOG = {
    "units": [["B_Soldier_F", "Rifleman", "west", "NATO", "Men", ""], ["O_Soldier_F", "Rifleman", "east", "CSAT", "Men", ""],
              ["I_Soldier_F", "Rifleman", "independent", "AAF", "Men", ""]],
    "vehicles": [["B_MRAP_01_F", "Hunter", "west", "NATO", "car", "Cars", ""], ["O_Heli_Light_02_F", "PO-30 Orca", "east", "CSAT", "helicopter", "Helicopters", "heli"]],
    "objects": [["Box_NATO_Ammo_F", "Basic Ammo [NATO]", "Supplies", "Ammo", ""], ["Land_BagFence_Long_F", "Bag Fence (Long)", "Structures", "Walls", ""]],
    "groups": [["West/BLU_F/Infantry/BUS_InfSquad", "Rifle Squad", "west", "NATO", "Infantry", 8],
               ["East/OPF_F/Infantry/OIA_InfSquad", "Rifle Squad", "east", "CSAT", "Infantry", 8]],
    "weapons": [["arifle_MX_F", "MX 6.5 mm", "primary", ""], ["launch_NLAW_F", "PCML", "launcher", ""]],
    "magazines": [["30Rnd_65x39_caseless_mag", "6.5mm 30Rnd Mag", 30], ["HandGrenade", "RGO Grenade", 1]],
    "gear": [["FirstAidKit", "First Aid Kit", "item"], ["optic_Hamr", "RCO", "optic"]],
    "backpacks": [["B_AssaultPack_mcamo", "Assault Pack (MTP)", 160]],
    "marker_types": [["mil_dot", "Dot"], ["mil_objective", "Objective"]],
    "marker_colors": [["ColorBlack", "Black", [0, 0, 0, 1]], ["ColorRed", "Red", [0.9, 0, 0, 1]], ["ColorBLUFOR", "BLUFOR", [0, 0.3, 0.6, 1]]],
}


def export_fake_catalog(ext):
    """Plays fn_exportCatalog.sqf with a handful of rows per section."""
    ext.call("catalog_begin", [])
    for section in SPEC["catalog"]:
        rows = FAKE_CATALOG[section["name"]]
        assert all(len(r) == len(section["fields"]) for r in rows), section["name"]
        ext.call("catalog_add", [section["name"], sqf_str(rows)])
    ext.call("catalog_commit", [])


def export_fake_map(ext):
    """Plays fn_exportMap.sqf: an island with hills, forests, a ring road, a village and place names."""
    n, fn = 256, 64
    cell, fcell = SIZE / n, SIZE / fn
    ext.call("map_begin", [WORLD, SIZE, n, fn])

    def height(x, y):
        r = math.hypot(x - 4096, y - 4096)
        hills = 60 * math.sin(x / 700) * math.cos(y / 900) + 90 * math.exp(-((x - 3000) ** 2 + (y - 5000) ** 2) / 600 ** 2)
        return 140 * math.exp(-(r / 2600) ** 2) + max(0, hills) * math.exp(-(r / 3200) ** 2) - 25

    for j in range(n):
        ext.call("map_add", ["heights", sqf_str([round(height((i + 0.5) * cell, (j + 0.5) * cell)) for i in range(n)])])
        if j % 64 == 0:
            ext.call("map_progress", [35 * j // n, "heights"])
    for j in range(fn):
        row = []
        for i in range(fn):
            x, y = (i + 0.5) * fcell, (j + 0.5) * fcell
            wood = math.sin(x / 400) + math.cos(y / 500) > 0.8 and height(x, y) > 10
            row.append(200 if wood else 3)
        ext.call("map_add", ["forest", sqf_str(row)])
    ring = [(4096 + 1800 * math.cos(a / 40 * 2 * math.pi), 4096 + 1800 * math.sin(a / 40 * 2 * math.pi)) for a in range(41)]
    roads = [[round(a[0]), round(a[1]), round(b[0]), round(b[1]), "MAIN ROAD", 10] for a, b in zip(ring, ring[1:])]
    roads += [[4096, 4096 + k * 100, 4096, 4096 + (k + 1) * 100, "ROAD", 7] for k in range(-18, 18)]
    roads += [[3000 + k * 80, 5000, 3000 + (k + 1) * 80, 5040, "TRACK", 4] for k in range(15)]
    for k in range(0, len(roads), 100):
        ext.call("map_add", ["roads", sqf_str(roads[k:k + 100])])
    houses = [[4000 + (k % 8) * 25, 4250 + (k // 8) * 22, (k * 17) % 90, 10 + k % 4, 8 + k % 3] for k in range(48)]
    ext.call("map_add", ["buildings", sqf_str(houses)])
    places = [["Agios Fakos", "NameCity", 4060, 4300], ["Kalo Test", "NameVillage", 5700, 4100],
              ["Mont Bridge", "Hill", 3000, 5000], ["Baie de Rust", "NameMarine", 1500, 2500]]
    ext.call("map_add", ["places", sqf_str(places)])
    ext.call("map_commit", [WORLD])


def sqf_str(v):
    """Mimics the engine's str: 6 significant digits, "" escaping, any for nil."""
    if v is None:
        return "any"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return format(float(v), ".6g")
    if isinstance(v, str):
        return '"' + v.replace('"', '""') + '"'
    return "[" + ",".join(sqf_str(x) for x in v) + "]"


def parse_simple_array(text):
    """Mimics parseSimpleArray on what the extension sends."""
    pos = 0

    def value():
        nonlocal pos
        while text[pos] in " \t\r\n":
            pos += 1
        c = text[pos]
        if c == "[":
            pos += 1
            items = []
            while True:
                while text[pos] in " \t\r\n,":
                    pos += 1
                if text[pos] == "]":
                    pos += 1
                    return items
                items.append(value())
        if c == '"':
            pos += 1
            out = []
            while True:
                if text[pos] == '"':
                    if pos + 1 < len(text) and text[pos + 1] == '"':
                        out.append('"')
                        pos += 2
                        continue
                    pos += 1
                    return "".join(out)
                out.append(text[pos])
                pos += 1
        start = pos
        while text[pos] not in ",]":
            pos += 1
        word = text[start:pos].strip()
        if word in ("true", "false"):
            return word == "true"
        return float(word)

    return value()


class Extension:
    def __init__(self, path):
        self.dll = ctypes.CDLL(str(path))
        f = self.dll.RVExtensionArgs
        f.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p), ctypes.c_int]
        f.restype = ctypes.c_int
        self.buf = ctypes.create_string_buffer(OUTPUT_SIZE)
        self.calls = 0

    def call(self, function, args):
        # The engine passes every argument through str, so strings arrive quoted.
        enc = [sqf_str(a).encode("utf-8") for a in args]
        argv = (ctypes.c_char_p * max(1, len(enc)))(*enc)
        code = self.dll.RVExtensionArgs(self.buf, OUTPUT_SIZE, function.encode(), argv, len(enc))
        self.calls += 1
        return self.buf.value.decode("utf-8"), code

    def version(self):
        f = self.dll.RVExtensionVersion
        f.argtypes = [ctypes.c_char_p, ctypes.c_int]
        f(self.buf, OUTPUT_SIZE)
        return self.buf.value.decode()


class FakeGame:
    """A tiny scenario: units walk in circles, commands create and change them."""

    def __init__(self, ext):
        self.ext = ext
        self.counter = 0
        self.units = {}
        self.vehicles = {}
        self.groups = {}
        self.markers = {}
        self.events = []
        self.running = True
        self.polling = True
        self.t0 = time.time()
        self.max_poll_parts = 0
        self.biggest_command = 0
        for i in range(40):
            self.spawn_unit("B_Soldier_F", [1000 + i * 3, 2000, 0], "west")
        self.units["u2"]["is_player"] = True

    def new_id(self, prefix):
        self.counter += 1
        return f"{prefix}{self.counter}"

    def spawn_unit(self, type_, pos, side, group="none"):
        if group == "none":
            group = self.new_id("g")
            self.groups[group] = {"id": group, "name": f"Alpha {group}", "side": side, "units": []}
        uid = self.new_id("u")
        self.units[uid] = {"id": uid, "type": type_, "name": f"Soldier {uid}", "side": side, "group": group,
                           "pos": list(pos), "dir": 0, "health": 1, "alive": True, "vehicle": "", "is_player": False, "speed": 0}
        self.groups[group]["units"].append(uid)
        self.events.append(["created", self.time(), [uid, type_, pos]])
        return uid, group

    def time(self):
        return time.time() - self.t0

    def send(self, kind, text):
        for i in range(0, len(text), CHUNK):
            self.ext.call("chunk", [text[i:i + CHUNK]])
        self.ext.call("commit", [kind])

    def execute(self, req, name, args):
        if name == "spawn_unit":
            type_, pos, side, group = args[0], args[1], args[2], args[3]
            uid, gid = self.spawn_unit(type_, pos, side, group)
            return [req, True, [uid, gid]]
        if name == "spawn_vehicle":
            vid = self.new_id("v")
            self.vehicles[vid] = {"id": vid, "type": args[0], "side": "civilian", "pos": args[1], "dir": args[2],
                                  "health": 1, "alive": True, "fuel": 1, "crew": [], "speed": 0}
            return [req, True, [vid, [], ""]]
        if name == "set_health":
            unit = self.units.get(args[0])
            if not unit:
                return [req, False, f"unknown or deleted id: {args[0]}"]
            unit["health"] = args[1]
            unit["alive"] = args[1] > 0
            if not unit["alive"]:
                self.events.append(["killed", self.time(), [unit["id"], unit["type"], "", "", unit["pos"]]])
            return [req, True, [unit["id"], unit["health"], unit["alive"]]]
        if name == "exec_sqf":
            # Echo the code back so the client can check quoting, accents and large payloads.
            self.biggest_command = max(self.biggest_command, len(args[0]))
            return [req, True, [args[0]]]
        if name == "teleport" and args[1][:2] == [666, 666]:
            return None  # simulate a script that never answers
        if name == "message":
            return [req, True, [args[2]]]
        if name == "spawn_group":
            path, pos, side = args[0], args[1], args[3]
            if path.count("/") != 3:
                return [req, False, f"unknown group: {path} (see GET /catalog, section groups)"]
            side = {"West": "west", "East": "east", "Indep": "independent"}.get(path.split("/")[0], "civilian") if side == "default" else side
            leader, gid = self.spawn_unit("B_Soldier_SL_F", pos, side)
            members = [leader] + [self.spawn_unit("B_Soldier_F", [pos[0] + k * 3, pos[1], 0], side, gid)[0] for k in range(1, 4)]
            return [req, True, [gid, members, []]]
        if name == "spawn_effect":
            return [req, True, [args[0], args[2]]]
        if name == "set_marker":
            mname = args[0]
            if mname == "auto":
                mname = self.new_id("a3b_marker_")
            self.markers[mname] = {"name": mname, "pos": args[1], "text": "" if args[2] == "none" else args[2], "type": args[3],
                                   "color": args[4], "shape": args[5], "size": [args[6], args[7]], "dir": args[8], "alpha": args[9]}
            return [req, True, [mname]]
        if name == "delete_marker":
            if self.markers.pop(args[0], None) is None:
                return [req, False, f"unknown marker: {args[0]}"]
            return [req, True, [args[0]]]
        # Tactical orders and questions: plausible answers shaped like the real scripts'.
        target = args[0] if args else ""
        if name in ("add_waypoint", "patrol", "defend", "attack", "query_group") and not str(target).startswith(("g", "u", "v")):
            return [req, False, f"unknown or deleted id: {target}"]
        def in_area():
            d = lambda u: math.hypot(u["pos"][0] - args[0][0], u["pos"][1] - args[0][1])
            return [[[u["id"], u["type"], u["side"], round(d(u))] for u in self.units.values() if d(u) <= args[1]][:50], [], [["west", len(self.units)]]]

        canned = {
            "add_waypoint": lambda: [target, 1, 2],
            "patrol": lambda: [target, 5],
            "defend": lambda: [target, 3, 12],
            "attack": lambda: [target, args[1]],
            "artillery_fire": lambda: [target, "32Rnd_155mm_Mo_shells", 21],
            "vehicle_crew": lambda: [target, 2],
            "paradrop": lambda: [target, 4],
            "set_loadout": lambda: [target, "arifle_MX_F"],
            "set_supplies": lambda: [target, 3],
            "fill_crate": lambda: [target, sum(i[1] for i in args[1])],
            "query_area": in_area,
            "query_knowledge": lambda: [target, []],
            "query_visibility": lambda: [1, False, 250, 0],
            "query_terrain": lambda: [12, False, 3, ["Agios Fakos", "NameCity", 120], 4, [4100, 4300, 0], 6, 30, 50],
            "query_group": lambda: [target, "u2", "aware", "yellow", "normal", "wedge", 1, [["move", [1000, 2000, 0]]], True, [["u90", "O_Soldier_F", "east", 210]], [["u2", "B_Soldier_F", True, 1, 6, ""]]],
            "query_cover": lambda: [args[1], [[[args[0][0] - 12, args[0][1] + 5, 0], 0, 13, False], [[args[0][0] + 20, args[0][1] - 8, 0], 0.1, 22, True]], 96],
        }
        if name in canned:
            return [req, True, canned[name]()]
        return [req, False, f"fake game does not implement {name}"]

    def state(self):
        rows = {}
        world = {"world": WORLD, "mission": "fake_mission", "time": self.time(), "daytime": 12.5,
                 "date": [2035, 6, 24, 12, 30], "overcast": 0.3, "rain": 0, "fog": 0, "fps": 60, "players": 1, "size": 8192}
        rows["world"] = world
        rows["units"] = list(self.units.values())
        rows["vehicles"] = list(self.vehicles.values())
        rows["groups"] = [dict(g, leader=g["units"][0], behaviour="aware", combat_mode="yellow", speed_mode="normal", destination=[])
                          for g in self.groups.values()]
        rows["objects"] = []
        rows["markers"] = list(self.markers.values())
        out = []
        for ent in SPEC["entities"]:
            data = rows[ent["name"]]
            if ent["multiple"]:
                out.append([[item.get(f) for f in ent["fields"]] for item in data])
            else:
                out.append([data.get(f) for f in ent["fields"]])
        return out

    def run(self):
        next_state = 0
        next_chat = time.time() + 2
        next_shot = time.time() + 1
        next_waypoint = time.time() + 3
        shots = 0
        while self.running:
            frame = time.time()
            # A firefight: the first west units shoot north-east, now and then with a rocket.
            if frame >= next_shot:
                next_shot = frame + 0.25
                shots += 1
                shooter = self.units[f"u{2 * (shots % 5) + 2}"]
                angle = math.radians(40 + (shots * 7) % 30)
                kind = "shotRocket" if shots % 12 == 0 else "shotBullet"
                self.events.append(["fired", self.time(), [shooter["id"], "arifle_MX_F", "B_65x39_Caseless", "", shooter["pos"],
                                                          [round(math.sin(angle), 2), round(math.cos(angle), 2), 0.02], kind, "west"]])
                if shots % 20 == 0:
                    self.events.append(["hit", self.time(), [shooter["id"], "u90", 0.2, 0.8]])
            if frame >= next_waypoint:
                next_waypoint = frame + 5
                self.events.append(["waypoint_completed", self.time(), ["g1", 1, 2, [1100, 2100, 0]]])
                self.events.append(["enemy_detected", self.time(), ["g1", "u90", "O_Soldier_F", "east", [1200, 2200, 0]]])
            # The player in u2 writes in side chat every 10 seconds, like a human asking the commander.
            if frame >= next_chat:
                next_chat = frame + 10
                self.events.append(["chat", self.time(), ["side", "Joueur1", "u2", "west", "Commandant, envoyez des renforts à Agios Fakos"]])
            for u in self.units.values():
                if u["alive"]:
                    a = self.time()
                    u["pos"][0] += math.cos(a) * 0.1
                    u["pos"][1] += math.sin(a) * 0.1
            if self.polling:
                buf, parts = "", 0
                while True:
                    part, _ = self.ext.call("poll", [25])
                    if not part:
                        break
                    parts += 1
                    buf += part[1:]
                    if part[0] == "0":
                        break
                self.max_poll_parts = max(self.max_poll_parts, parts)
                if buf:
                    for req, name, args in parse_simple_array(buf):
                        # Like the real dispatcher: a failing command answers with an error, the game goes on.
                        try:
                            res = self.execute(req, name, args)
                        except Exception as e:
                            res = [req, False, f"fake game error in {name}: {e!r}"]
                        if res is not None:
                            self.send("result", sqf_str(res))
                if self.events:
                    ev, self.events = self.events, []
                    self.send("events", sqf_str(ev))
                if time.time() >= next_state:
                    next_state = time.time() + 0.1
                    self.send("state", sqf_str(self.state()))
            time.sleep(max(0, 1 / 60 - (time.time() - frame)))


def main():
    work = Path(tempfile.mkdtemp(prefix="a3_bridge_test_"))
    dll = work / "a3_bridge_x64.dll"
    source = Path(sys.argv[sys.argv.index("--dll") + 1]) if "--dll" in sys.argv else ROOT / "dist" / "@a3_bridge" / "a3_bridge_x64.dll"
    shutil.copyfile(source, dll)
    if (source.parent / "ui").is_dir():
        shutil.copytree(source.parent / "ui", work / "ui")
    (work / "a3_bridge.json").write_text(json.dumps({"port": PORT, "command_timeout_ms": 1500}))
    # Logs, map cache and recordings go to a throwaway folder instead of the real %LOCALAPPDATA%\Arma 3.
    (work / "localappdata" / "Arma 3").mkdir(parents=True)
    os.environ["LOCALAPPDATA"] = str(work / "localappdata")

    ext = Extension(dll)
    print("version:", ext.version())
    out, code = ext.call("start", ["fake_mission", WORLD, False])
    print("start ->", out, "code", code)
    assert code == 0, "gateway did not start"
    settings = parse_simple_array(out)
    assert settings[0] == 100, settings

    # Always rebuild the fake map, like a first game on a new world.
    cache = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Arma 3" / "a3_bridge_maps" / "fakeisland.json"
    cache.unlink(missing_ok=True)
    needed, _ = ext.call("map_needed", [WORLD, SIZE])
    assert needed == "1", "fresh world should need a map"
    threading.Thread(target=export_fake_map, args=(ext,), daemon=True).start()
    needed, _ = ext.call("catalog_needed", [])
    assert needed == "1", "a fresh process should need the catalog"
    export_fake_catalog(ext)
    assert ext.call("catalog_needed", [])[0] == "0", "catalog should be read once per process"

    game = FakeGame(ext)
    thread = threading.Thread(target=game.run, daemon=True)
    thread.start()

    if "--serve" in sys.argv:
        # Keep the fake scenario running so the web page can be tried by hand.
        print(f"fake scenario running: http://127.0.0.1:{PORT}/ui (Ctrl+C to stop), mod folder {work}", flush=True)
        thread.join()
        return

    def control():
        # The client asks us to stop polling to check the game_not_running path.
        for line in proc.stdout:
            print("  client|", line.rstrip())
            if "STOP_POLLING" in line:
                game.polling = False

    proc = subprocess.Popen(["node", str(ROOT / "tests" / "client_test.mjs"), str(PORT)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    reader = threading.Thread(target=control)
    reader.start()
    proc.wait()
    reader.join()
    game.running = False
    print(f"fake game: {ext.calls} extension calls, biggest command {game.biggest_command} chars, "
          f"up to {game.max_poll_parts} poll parts per frame")
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
