if !(isClass (configFile >> "CfgVehicles" >> _type)) then {throw format ["unknown class: %1", _type]};
if (_type isKindOf "AllVehicles") then {throw format ["%1 is a unit or vehicle class (use spawn_unit or spawn_vehicle)", _type]};

private _obj = createVehicle [_type, _pos, [], 0, "CAN_COLLIDE"];
if (isNull _obj) then {throw "createVehicle failed"};
_obj setDir _dir;
_obj setPosATL _pos;
A3B_objects pushBack _obj;
[_obj call A3B_fnc_id]
