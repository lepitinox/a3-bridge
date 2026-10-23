private _grp = _id call A3B_fnc_groupOf;
_grp call A3B_fnc_clearWaypoints;

// Every position inside the buildings around the point, shuffled so units spread across buildings.
private _spots = [];
{_spots append (_x buildingPos -1)} forEach (nearestObjects [_pos, ["House", "Building"], _radius]);
_spots = _spots call BIS_fnc_arrayShuffle;

private _garrisoned = 0;
{
    if (_forEachIndex < count _spots) then {
        private _spot = _spots select _forEachIndex;
        _x doMove _spot;
        _garrisoned = _garrisoned + 1;
        // Once in place (or after two minutes), the soldier stays and stands at the window.
        [_x, _spot] spawn {
            params ["_unit", "_spot"];
            private _until = time + 120;
            waitUntil {sleep 1; !alive _unit || {_unit distance _spot < 2} || {time > _until}};
            if (alive _unit) then {doStop _unit; _unit setUnitPos "UP"};
        };
    } else {
        // No room left inside: take a covered position around the point.
        _x doMove (_pos getPos [random (_radius / 2), random 360]);
        [_x] spawn {
            params ["_unit"];
            sleep 30;
            if (alive _unit) then {doStop _unit; _unit setUnitPos "MIDDLE"};
        };
    };
} forEach ((units _grp) select {vehicle _x == _x && {!isPlayer _x}});
[_grp call A3B_fnc_id, _garrisoned, count _spots]
