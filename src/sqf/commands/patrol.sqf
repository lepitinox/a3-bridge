private _grp = _id call A3B_fnc_groupOf;
_grp call A3B_fnc_clearWaypoints;
[_grp, _pos, _radius] call BIS_fnc_taskPatrol;
[_grp call A3B_fnc_id, count waypoints _grp]
