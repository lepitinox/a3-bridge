private _roads = _pos nearRoads _radius;
private _nearestRoad = if (_roads isEqualTo []) then {[]} else {
    getPosATL (([_roads, [], {_x distance2D _pos}, "ASCEND"] call BIS_fnc_sortBy) select 0)
};
private _houses = (nearestObjects [_pos, ["House", "Building"], _radius]) select {(_x buildingPos -1) isNotEqualTo []};
private _positions = 0;
{_positions = _positions + count (_x buildingPos -1)} forEach _houses;
private _place = (nearestLocations [_pos, ["NameCityCapital", "NameCity", "NameVillage", "NameLocal", "Hill", "NameMarine"], 5000]) param [0, locationNull];
[
    round getTerrainHeightASL _pos,
    surfaceIsWater _pos,
    round acos ((surfaceNormal _pos) select 2),
    if (isNull _place) then {[]} else {[text _place, type _place, round ((locationPosition _place) distance2D _pos)]},
    count _roads,
    _nearestRoad,
    count _houses,
    _positions,
    count nearestTerrainObjects [_pos, ["TREE", "SMALL TREE", "BUSH"], _radius, false, true]
]
