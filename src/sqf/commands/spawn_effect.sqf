private _def = (call A3B_fnc_effects) get _effect;
if (isNil "_def") then {throw format ["unknown effect: %1", _effect]};

// One shot at a random point within the spread: shells and bombs fall from their altitude
// at their speed, smoke grenades and mines are placed on the ground.
private _shoot = {
    params ["_def", "_pos", "_spread"];
    _def params ["_kind", "_class", "_altitude", "_speed"];
    private _angle = random 360;
    private _dist = _spread * sqrt random 1;
    private _at = [(_pos select 0) + _dist * sin _angle, (_pos select 1) + _dist * cos _angle, 0];
    switch (_kind) do {
        case "mine": {createMine [_class, _at, [], 0]};
        case "smoke": {createVehicle [_class, _at, [], 0, "CAN_COLLIDE"]};
        default {
            private _shell = createVehicle [_class, _at vectorAdd [0, 0, _altitude], [], 0, "CAN_COLLIDE"];
            _shell setVectorDirAndUp [[0, 0, -1], [0, 1, 0]];
            _shell setVelocity [0, 0, -_speed];
        };
    };
};

if (_count <= 1) then {
    [_def, _pos, _spread] call _shoot;
} else {
    // Salvos run in the background so the command answers at once.
    [[_def, _pos, _spread], _shoot, _count, _delay] spawn {
        params ["_args", "_shoot", "_count", "_delay"];
        for "_i" from 1 to _count do {
            _args call _shoot;
            sleep _delay;
        };
    };
};
[_effect, _count]
