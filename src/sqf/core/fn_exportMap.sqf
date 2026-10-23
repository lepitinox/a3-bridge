/*
 * Builds the background map of the current world from the engine itself (terrain heights, forest
 * density, roads, buildings, place names) and hands it to the extension, which caches it per world.
 * Runs scheduled and sends small pieces, so the scenario keeps running smoothly while it works.
 */
private _size = worldSize;
private _t0 = diag_tickTime;
private _progress = {"a3_bridge" callExtension ["map_progress", _this]};
// Each piece is one SQF array appended to a section of the map on the extension side.
private _emit = {
    params ["_section", "_items"];
    "a3_bridge" callExtension ["map_add", [_section, str _items]];
};

private _n = ((round (_size / A3B_cfg_map_height_cell_m)) min A3B_cfg_map_max_cells) max 16;
private _cell = _size / _n;
private _fn = ((round (_size / A3B_cfg_map_forest_cell_m)) min 256) max 8;
private _fcell = _size / _fn;
"a3_bridge" callExtension ["map_begin", [worldName, _size, _n, _fn]];

// Terrain heights at cell centres, one row per piece, from south to north.
for "_j" from 0 to (_n - 1) do {
    private _y = (_j + 0.5) * _cell;
    private _row = [];
    for "_i" from 0 to (_n - 1) do {
        _row pushBack round getTerrainHeightASL [(_i + 0.5) * _cell, _y];
    };
    ["heights", _row] call _emit;
    if (_j % 32 == 0) then {[floor (35 * _j / _n), "heights"] call _progress};
};

// Number of trees and bushes per cell.
for "_j" from 0 to (_fn - 1) do {
    private _row = [];
    for "_i" from 0 to (_fn - 1) do {
        _row pushBack count nearestTerrainObjects [[(_i + 0.5) * _fcell, (_j + 0.5) * _fcell], ["TREE", "SMALL TREE", "BUSH"], _fcell * 0.71, false, true];
    };
    ["forest", _row] call _emit;
    if (_j % 8 == 0) then {[35 + floor (30 * _j / _fn), "forests"] call _progress};
};

// Roads and buildings, 1 km tile by 1 km tile; each object is kept by the tile containing it.
private _tile = 1000;
private _tn = ceil (_size / _tile);
private _types = ["BUILDING", "HOUSE", "CHURCH", "CHAPEL", "BUNKER", "FORTRESS", "FUELSTATION", "HOSPITAL", "LIGHTHOUSE", "VIEW-TOWER", "WATERTOWER", "TRANSMITTER", "RUIN", "TOURISM", "QUAY", "SHIPWRECK", "POWERSOLAR", "POWERWIND", "STACK", "BUSSTOP", "FOUNTAIN"];
private _roads = [];
private _buildings = [];
for "_tj" from 0 to (_tn - 1) do {
    for "_ti" from 0 to (_tn - 1) do {
        private _x0 = _ti * _tile;
        private _y0 = _tj * _tile;
        private _centre = [_x0 + _tile / 2, _y0 + _tile / 2];
        private _inside = {
            params ["_p"];
            (_p select 0) >= _x0 && {(_p select 0) < _x0 + _tile} && {(_p select 1) >= _y0} && {(_p select 1) < _y0 + _tile}
        };
        {
            private _info = getRoadInfo _x;
            private _beg = _info param [6, []];
            private _end = _info param [7, []];
            if (count _beg >= 2 && {count _end >= 2} && {[position _x] call _inside}) then {
                _roads pushBack [round (_beg select 0), round (_beg select 1), round (_end select 0), round (_end select 1), _info select 0, _info select 1];
            };
            if (count _roads >= 100) then {["roads", _roads] call _emit; _roads = []};
        } forEach (_centre nearRoads (_tile * 0.71));
        {
            if ([position _x] call _inside) then {
                (boundingBoxReal _x) params ["_p1", "_p2"];
                private _p = getPosWorld _x;
                _buildings pushBack [
                    round (_p select 0), round (_p select 1), round getDir _x,
                    (round abs ((_p2 select 0) - (_p1 select 0))) max 1, (round abs ((_p2 select 1) - (_p1 select 1))) max 1
                ];
            };
            if (count _buildings >= 100) then {["buildings", _buildings] call _emit; _buildings = []};
        } forEach (nearestTerrainObjects [_centre, _types, _tile * 0.71, false, true]);
    };
    [65 + floor (30 * _tj / _tn), "roads"] call _progress;
};
if (_roads isNotEqualTo []) then {["roads", _roads] call _emit};
if (_buildings isNotEqualTo []) then {["buildings", _buildings] call _emit};

// Place names.
private _places = (nearestLocations [[_size / 2, _size / 2], ["NameCityCapital", "NameCity", "NameVillage", "NameLocal", "NameMarine", "Hill"], _size]) select {text _x isNotEqualTo ""};
private _batch = [];
{
    private _p = locationPosition _x;
    _batch pushBack [text _x, type _x, round (_p select 0), round (_p select 1)];
    if (count _batch >= 40) then {["places", _batch] call _emit; _batch = []};
} forEach _places;
if (_batch isNotEqualTo []) then {["places", _batch] call _emit};

"a3_bridge" callExtension ["map_commit", [worldName]];
diag_log format ["[a3_bridge] map of %1 exported in %2 s (%3x%3 heights, %4 places)", worldName, round (diag_tickTime - _t0), _n, count _places];
