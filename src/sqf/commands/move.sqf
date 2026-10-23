private _e = _id call A3B_fnc_resolve;
private _grp = grpNull;
if (_e isEqualType grpNull) then {
    _grp = _e;
} else {
    if !(_e isKindOf "AllVehicles") then {throw "objects cannot move on their own (use teleport)"};
    // A vehicle is driven by whoever commands it.
    if !(_e isKindOf "CAManBase") then {
        _e = effectiveCommander _e;
        if (isNull _e) then {throw "this vehicle has no crew"};
    };
    if (!alive _e) then {throw "this unit is dead"};
    _grp = group _e;
};

// A group or its leader gets a fresh move waypoint; any other member is ordered individually.
if (_e isEqualType grpNull || {leader _grp == _e}) then {
    for "_i" from (count waypoints _grp - 1) to 1 step -1 do {deleteWaypoint [_grp, _i]};
    private _wp = _grp addWaypoint [_pos, 0];
    _wp setWaypointType "MOVE";
    _grp setCurrentWaypoint _wp;
} else {
    _e doMove _pos;
};
[_id, _grp call A3B_fnc_id]
