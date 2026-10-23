private _unit = _id call A3B_fnc_resolve;
if !(_unit isEqualType objNull && {_unit isKindOf "CAManBase"}) then {throw "set_loadout expects a soldier id"};
if !(isClass (configFile >> "CfgVehicles" >> _from_class) && {_from_class isKindOf "CAManBase"}) then {throw format ["unknown soldier class: %1 (see GET /catalog, section units)", _from_class]};
private _loadout = getUnitLoadout _from_class;
// The loadout must be applied where the unit is local (the player's machine for a player).
[_unit, _loadout] remoteExec ["setUnitLoadout", _unit];
[_id, (_loadout select 0) param [0, ""]]
