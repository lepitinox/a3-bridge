private _e = _id call A3B_fnc_resolve;
private _men = (if (_e isEqualType grpNull) then {units _e} else {[_e]}) select {_x isKindOf "CAManBase" && {alive _x} && {!isPlayer _x}};
if (_men isEqualTo []) then {throw "no AI soldier to drop (players are never moved)"};

// Each soldier gets a steerable parachute, spread on a small spiral so they do not collide.
{
    if (vehicle _x != _x) then {moveOut _x};
    private _at = _pos getPos [8 * _forEachIndex, 45 * _forEachIndex];
    _at set [2, _altitude];
    private _chute = createVehicle ["Steerable_Parachute_F", _at, [], 0, "FLY"];
    _chute setPosATL _at;
    _x moveInDriver _chute;
} forEach _men;
[_id, count _men]
