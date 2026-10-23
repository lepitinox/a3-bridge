if !(isClass (configFile >> "CfgVehicles" >> _type)) then {throw format ["unknown class: %1", _type]};
if (_type isKindOf "CAManBase") then {throw format ["%1 is a soldier class (use spawn_unit)", _type]};
if !(_type isKindOf "AllVehicles") then {throw format ["%1 is not a vehicle class (use spawn_object)", _type]};

// Aircraft asked above 20 m start flying instead of falling.
private _flying = _type isKindOf "Air" && {(_pos select 2) > 20};
private _veh = createVehicle [_type, _pos, [], 0, ["CAN_COLLIDE", "FLY"] select _flying];
if (isNull _veh) then {throw "createVehicle failed"};
_veh setDir _dir;
if (!_flying) then {_veh setPosATL _pos};

private _crewIds = [];
private _grpId = "";
if (_crew) then {
    private _grp = createVehicleCrew _veh;
    if (!isNull _grp && {_side isNotEqualTo "default"}) then {
        private _newGrp = createGroup [_side call A3B_fnc_sideFromName, true];
        if (isNull _newGrp) then {throw "could not create a new group: the engine allows 288 groups per side"};
        (units _grp) joinSilent _newGrp;
        _grp = _newGrp;
    };
    if (!isNull _grp) then {_grpId = _grp call A3B_fnc_id};
    _crewIds = (crew _veh) apply {_x call A3B_fnc_id};
};
[_veh call A3B_fnc_id, _crewIds, _grpId]
