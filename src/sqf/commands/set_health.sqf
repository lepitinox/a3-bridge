private _e = _id call A3B_fnc_resolve;
if (_e isEqualType grpNull) then {throw "set_health expects a unit, vehicle or object id, not a group"};
_e setDamage (1 - _health);
[_id, 1 - damage _e, alive _e]
