if !(isClass (configFile >> "CfgVehicles" >> _type)) then {throw format ["unknown class: %1", _type]};
if !(_type isKindOf "CAManBase") then {throw format ["%1 is not a soldier class (use spawn_vehicle or spawn_object)", _type]};

private _grp = grpNull;
if (_group isEqualTo "none") then {
    _grp = createGroup [_side call A3B_fnc_sideFromName, true];
} else {
    _grp = _group call A3B_fnc_resolve;
    if (_grp isEqualType objNull) then {_grp = group _grp};
};
if (isNull _grp) then {throw "could not create a new group: the engine allows 288 groups per side; pass 'group' to add soldiers to an existing group"};

private _unit = _grp createUnit [_type, _pos, [], 0, "CAN_COLLIDE"];
if (isNull _unit) then {throw "createUnit failed"};
_unit setDir _dir;
_unit setPosATL _pos;
_unit setSkill _skill;
[_unit call A3B_fnc_id, _grp call A3B_fnc_id]
