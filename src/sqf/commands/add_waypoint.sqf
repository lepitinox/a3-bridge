private _grp = _id call A3B_fnc_groupOf;
private _engineType = createHashMapFromArray [
    ["move", "MOVE"], ["sad", "SAD"], ["destroy", "DESTROY"], ["guard", "GUARD"], ["hold", "HOLD"], ["sentry", "SENTRY"],
    ["get_in", "GETIN NEAREST"], ["get_out", "GETOUT"], ["unload", "UNLOAD"], ["transport_unload", "TR UNLOAD"],
    ["loiter", "LOITER"], ["cycle", "CYCLE"], ["dismiss", "DISMISS"]
] get _type;

if (_replace) then {_grp call A3B_fnc_clearWaypoints};
private _wp = _grp addWaypoint [_pos, _radius];
_wp setWaypointType _engineType;
if (_behaviour isNotEqualTo "unchanged") then {_wp setWaypointBehaviour toUpper _behaviour};
if (_combat_mode isNotEqualTo "unchanged") then {_wp setWaypointCombatMode toUpper _combat_mode};
if (_speed_mode isNotEqualTo "unchanged") then {_wp setWaypointSpeed toUpper _speed_mode};
if (_formation isNotEqualTo "unchanged") then {_wp setWaypointFormation toUpper (_formation splitString "_" joinString " ")};
if (_replace) then {_grp setCurrentWaypoint _wp};
[_grp call A3B_fnc_id, _wp select 1, count waypoints _grp]
