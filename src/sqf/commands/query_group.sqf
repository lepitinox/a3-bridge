private _grp = _id call A3B_fnc_groupOf;
private _leader = leader _grp;
// Enemies the leader has spotted: nearTargets lists [position, type, side, cost, object, accuracy].
private _enemies = (_leader nearTargets 2000) select {((side _grp) getFriend (_x select 2)) < 0.6};
[
    _grp call A3B_fnc_id,
    _leader call A3B_fnc_id,
    toLower behaviour _leader,
    toLower combatMode _grp,
    toLower speedMode _grp,
    toLower formation _grp,
    currentWaypoint _grp,
    (waypoints _grp) apply {[toLower waypointType _x, waypointPosition _x]},
    unitReady _leader,
    // Each known enemy: [id, class, side, distance to the leader].
    _enemies apply {[(_x select 4) call A3B_fnc_id, _x select 1, (_x select 2) call A3B_fnc_sideName, round ((_x select 0) distance2D _leader)]},
    (units _grp) apply {[
        _x call A3B_fnc_id,
        typeOf _x,
        alive _x,
        (round ((1 - damage _x) * 100)) / 100,
        count magazines _x,
        if (vehicle _x != _x) then {(vehicle _x) call A3B_fnc_id} else {""}
    ]}
]
