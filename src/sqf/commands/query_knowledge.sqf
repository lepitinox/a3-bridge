private _s = _side call A3B_fnc_sideFromName;
// Enemies of the side that it knows at least min_level about, best known first.
private _known = ((allUnits select {alive _x && {(_s getFriend side group _x) < 0.6}}) apply {[_s knowsAbout vehicle _x, _x]}) select {(_x select 0) >= _min_level};
_known = ([_known, [], {_x select 0}, "DESCEND"] call BIS_fnc_sortBy) select [0, _max];
// The position is only given for well-spotted targets (level 1.5 or more), as the side would know it.
[_side, _known apply {
    _x params ["_level", "_target"];
    [_target call A3B_fnc_id, typeOf vehicle _target, (side group _target) call A3B_fnc_sideName, (round (_level * 100)) / 100, [[], getPosATL _target] select (_level >= 1.5)]
}]
