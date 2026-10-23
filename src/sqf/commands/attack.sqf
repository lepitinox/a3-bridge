private _grp = _id call A3B_fnc_groupOf;
private _victim = _target call A3B_fnc_resolve;
if (_victim isEqualType grpNull) then {_victim = leader _victim};
if (!alive _victim) then {throw "the target is already dead or destroyed"};

// The group learns where the target is, then a destroy waypoint follows it wherever it goes.
_grp reveal [vehicle _victim, 4];
_grp call A3B_fnc_clearWaypoints;
private _wp = _grp addWaypoint [getPosATL _victim, 0];
_wp setWaypointType "DESTROY";
_wp waypointAttachVehicle vehicle _victim;
_grp setCurrentWaypoint _wp;
_grp setCombatMode "RED";
{_x doTarget vehicle _victim} forEach units _grp;
[_grp call A3B_fnc_id, _victim call A3B_fnc_id]
