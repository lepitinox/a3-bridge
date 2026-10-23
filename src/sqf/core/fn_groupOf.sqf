/*
 * Returns the group behind a bridge id: the group itself, or the group of a unit or of a vehicle's commander.
 * Throws when there is none.
 */
private _e = _this call A3B_fnc_resolve;
private _grp = call {
    if (_e isEqualType grpNull) exitWith {_e};
    if (_e isKindOf "CAManBase") exitWith {group _e};
    group effectiveCommander _e
};
if (isNull _grp) then {throw format ["%1 has no group", _this]};
_grp
