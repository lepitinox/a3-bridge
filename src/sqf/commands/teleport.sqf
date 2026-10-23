private _e = _id call A3B_fnc_resolve;
if (_e isEqualType grpNull) then {
    // Units on foot and the vehicles of the group are laid out on a 4 m grid around the position.
    private _vehicles = [];
    {if (vehicle _x != _x) then {_vehicles pushBackUnique vehicle _x}} forEach units _e;
    private _things = ((units _e) select {vehicle _x == _x}) + _vehicles;
    {
        if (_dir >= 0) then {_x setDir _dir};
        _x setPosATL (_pos vectorAdd [(_forEachIndex mod 5) * 4, floor (_forEachIndex / 5) * 4, 0]);
        _x setVelocity [0, 0, 0];
    } forEach _things;
} else {
    if (_e isKindOf "CAManBase" && {vehicle _e != _e}) then {moveOut _e};
    if (_dir >= 0) then {_e setDir _dir};
    _e setPosATL _pos;
    _e setVelocity [0, 0, 0];
};
[_id]
