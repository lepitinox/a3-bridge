private _wanted = if (_side isEqualTo "all") then {sideUnknown} else {_side call A3B_fnc_sideFromName};
private _keep = {_side isEqualTo "all" || {_this isEqualTo _wanted}};
private _byDistance = {[_this, [], {_x select 3}, "ASCEND"] call BIS_fnc_sortBy};

private _men = (_pos nearEntities [["CAManBase"], _radius]) select {alive _x && {(side group _x) call _keep}};
private _vehicles = (_pos nearEntities [["LandVehicle", "Air", "Ship", "StaticWeapon"], _radius]) select {(side _x) call _keep};

private _bySide = createHashMap;
{
    private _s = (side group _x) call A3B_fnc_sideName;
    _bySide set [_s, (_bySide getOrDefault [_s, 0]) + 1];
} forEach _men;

[
    (_men apply {[_x call A3B_fnc_id, typeOf _x, (side group _x) call A3B_fnc_sideName, round (_x distance2D _pos)]}) call _byDistance,
    (_vehicles apply {[_x call A3B_fnc_id, typeOf _x, (side _x) call A3B_fnc_sideName, round (_x distance2D _pos), count crew _x]}) call _byDistance,
    (keys _bySide) apply {[_x, _bySide get _x]}
]
