private _e = _id call A3B_fnc_resolve;
if (_e isEqualType grpNull) then {
    if ((units _e) findIf {isPlayer _x} >= 0) then {throw "this group contains a player; players cannot be deleted"};
    {
        if (vehicle _x != _x) then {(vehicle _x) deleteVehicleCrew _x} else {deleteVehicle _x};
    } forEach units _e;
    _e deleteGroupWhenEmpty true;
} else {
    if (isPlayer _e) then {throw "players cannot be deleted"};
    if (_e isKindOf "CAManBase") then {
        if (vehicle _e != _e) then {(vehicle _e) deleteVehicleCrew _e} else {deleteVehicle _e};
    } else {
        if ((crew _e) findIf {isPlayer _x} >= 0) then {throw "a player is inside this vehicle"};
        {_e deleteVehicleCrew _x} forEach crew _e;
        deleteVehicle _e;
    };
};
[_id]
