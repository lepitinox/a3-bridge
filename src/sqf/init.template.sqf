/*
 * Starts the bridge when a scenario begins. Only the machine that owns the scenario
 * (single player, or the dedicated / hosting server) talks to the extension.
 */
if (!isServer) exitWith {};

A3B_registry = createHashMap;
A3B_counter = 0;
A3B_events = [];
A3B_objects = [];
A3B_nextState = 0;
A3B_nextPrune = 0;

private _r = "a3_bridge" callExtension ["start", [missionName, worldName, isDedicated]];
_r params ["_out", "_code", "_err"];
if (_err != 0 || {_out isEqualTo ""}) exitWith {
    diag_log format ["[a3_bridge] extension unavailable (error %1, code %2): check that a3_bridge_x64.dll sits in the mod folder and that BattlEye is off.", _err, _code];
};
private _cfg = parseSimpleArray _out;
//@SETTINGS@

// Objects placed by the scenario, without units, vehicles, logics, triggers or effects.
A3B_objects = (allMissionObjects "All") select {
    private _t = typeOf _x;
    _t isNotEqualTo "" && {(_t select [0, 1]) isNotEqualTo "#"} && {!(_x isKindOf "AllVehicles")} && {!(_x isKindOf "Logic")} && {!(_x isKindOf "EmptyDetector")}
};

//@EVENTS@

A3B_eachFrame = addMissionEventHandler ["EachFrame", {call A3B_fnc_tick}];

// Catalog of placeable classes, groups and markers: read once per game process (mods do not change mid-game).
if (A3B_cfg_catalog_export && {(("a3_bridge" callExtension ["catalog_needed", []]) select 0) isEqualTo "1"}) then {
    [] spawn A3B_fnc_exportCatalog;
};

// Background map for the web page: built once per world, then served from the extension's cache.
if (A3B_cfg_map_export && {(("a3_bridge" callExtension ["map_needed", [worldName, worldSize]]) select 0) isEqualTo "1"}) then {
    [] spawn A3B_fnc_exportMap;
};
diag_log format ["[a3_bridge] ready: %1 on %2, extension says %3", missionName, worldName, _out];
