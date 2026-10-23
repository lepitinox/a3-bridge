private _e = _id call A3B_fnc_resolve;
// A group means its soldiers plus the vehicles they are in.
private _things = if (_e isEqualType grpNull) then {
    (units _e) + (((units _e) apply {vehicle _x}) select {!(_x isKindOf "CAManBase")})
} else {[_e]};
_things = _things arrayIntersect _things;
{
    // Both commands only act where the entity is local, hence remoteExec to its owner.
    if (_fuel >= 0 && {!(_x isKindOf "CAManBase")}) then {[_x, _fuel] remoteExec ["setFuel", _x]};
    if (_ammo >= 0) then {[_x, _ammo] remoteExec ["setVehicleAmmo", _x]};
} forEach _things;
[_id, count _things]
