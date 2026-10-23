private _e = _id call A3B_fnc_resolve;
private _men = (if (_e isEqualType grpNull) then {units _e} else {[_e]}) select {_x isKindOf "CAManBase" && {alive _x}};
if (_men isEqualTo []) then {throw "no living soldier to move"};
private _done = 0;

if (_action isEqualTo "get_in") then {
    if (_vehicle isEqualTo "none") then {throw "get_in needs a vehicle id"};
    private _veh = _vehicle call A3B_fnc_resolve;
    if (_veh isEqualType grpNull || {!(_veh isKindOf "AllVehicles")} || {_veh isKindOf "CAManBase"}) then {throw format ["%1 is not a vehicle", _vehicle]};
    {
        if (_instant) then {
            if (_x moveInAny _veh) then {_done = _done + 1};
        } else {
            // Free crew seats first, passengers after; the soldiers then walk to the vehicle.
            call {
                if (isNull driver _veh && {isNull assignedDriver _veh} && {_veh emptyPositions "driver" > 0}) exitWith {_x assignAsDriver _veh};
                if (isNull gunner _veh && {isNull assignedGunner _veh} && {_veh emptyPositions "gunner" > 0}) exitWith {_x assignAsGunner _veh};
                _x assignAsCargo _veh;
            };
            _done = _done + 1;
        };
    } forEach _men;
    if (!_instant) then {_men orderGetIn true};
} else {
    {
        if (vehicle _x != _x) then {
            if (_instant) then {moveOut _x} else {unassignVehicle _x; [_x] orderGetIn false};
            _done = _done + 1;
        };
    } forEach _men;
};
[_id, _done]
