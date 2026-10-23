/*
 * Returns the stable bridge id of an object or group, assigning one on first sight.
 * Prefixes: u = soldier, v = vehicle, g = group, o = any other object. Null or nil gives "".
 */
if (isNil "_this") exitWith {""};
private _o = _this;
if !(_o isEqualTypeAny [objNull, grpNull]) exitWith {""};
if (isNull _o) exitWith {""};

private _id = _o getVariable ["a3b_id", ""];
if (_id isEqualTo "") then {
    A3B_counter = A3B_counter + 1;
    private _prefix = call {
        if (_o isEqualType grpNull) exitWith {"g"};
        if (_o isKindOf "CAManBase") exitWith {"u"};
        if (_o isKindOf "AllVehicles") exitWith {"v"};
        "o"
    };
    _id = _prefix + (A3B_counter toFixed 0);
    _o setVariable ["a3b_id", _id];
    A3B_registry set [_id, _o];
    if (_prefix isEqualTo "u") then {_o call A3B_fnc_attachUnitEvents};
    if (_prefix isEqualTo "g") then {_o call A3B_fnc_attachGroupEvents};
};
_id
