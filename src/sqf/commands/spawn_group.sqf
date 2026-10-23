// The path walks CfgGroups: side / faction / category / group.
private _cfg = configFile >> "CfgGroups";
{_cfg = _cfg >> _x} forEach (_group splitString "/");
if !(isClass _cfg) then {throw format ["unknown group: %1 (see GET /catalog, section groups)", _group]};

private _groupSide = if (_side isEqualTo "default") then {
    [east, west, independent, civilian] param [getNumber (_cfg >> "side"), civilian]
} else {
    _side call A3B_fnc_sideFromName
};
private _grp = [_pos, _groupSide, _cfg, [], [], [], [], [], _dir] call BIS_fnc_spawnGroup;
if (isNil "_grp" || {isNull _grp}) then {throw "could not create the group: the engine allows 288 groups per side"};

private _vehicles = [];
{if (vehicle _x != _x) then {_vehicles pushBackUnique vehicle _x}} forEach units _grp;
[_grp call A3B_fnc_id, (units _grp) apply {_x call A3B_fnc_id}, _vehicles apply {_x call A3B_fnc_id}]
