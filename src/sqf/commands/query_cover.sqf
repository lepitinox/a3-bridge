// The threat looks from eye height; a soldier in cover is checked at crouched head height (1 m).
private _eye = (AGLToASL _threat) vectorAdd [0, 0, 1.7];

// Candidates: three rings around the position, every 15 degrees, plus the places inside nearby buildings.
private _candidates = [];
for "_ring" from 1 to 3 do {
    private _dist = _radius * _ring / 3;
    for "_angle" from 0 to 345 step 15 do {_candidates pushBack [_pos getPos [_dist, _angle], false]};
};
{
    {_candidates pushBack [_x, true]} forEach (_x buildingPos -1);
} forEach (nearestObjects [_pos, ["House", "Building"], _radius]);

private _covered = [];
{
    _x params ["_spot", "_inside"];
    if !(surfaceIsWater _spot) then {
        private _visibility = [objNull, "VIEW", objNull] checkVisibility [_eye, (AGLToASL _spot) vectorAdd [0, 0, 1]];
        if (_visibility < 0.25) then {
            _covered pushBack [round (_spot distance2D _pos), _spot apply {(round (_x * 10)) / 10}, (round (_visibility * 100)) / 100, _inside];
        };
    };
} forEach _candidates;

// Nearest first; each entry: [position, visibility from the threat 0-1, distance, inside a building].
_covered = ([_covered, [], {_x select 0}, "ASCEND"] call BIS_fnc_sortBy) select [0, _max];
[_threat, _covered apply {[_x select 1, _x select 2, _x select 0, _x select 3]}, count _candidates]
