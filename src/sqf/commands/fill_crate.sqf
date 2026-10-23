private _box = _id call A3B_fnc_resolve;
if (_box isEqualType grpNull) then {throw "fill_crate expects an object or vehicle id, not a group"};
if (_clear) then {
    clearItemCargoGlobal _box;
    clearWeaponCargoGlobal _box;
    clearMagazineCargoGlobal _box;
    clearBackpackCargoGlobal _box;
};
private _added = 0;
{
    _x params [["_class", "", [""]], ["_count", 1, [0]]];
    // Each kind of item has its own cargo command.
    call {
        if (isClass (configFile >> "CfgMagazines" >> _class)) exitWith {_box addMagazineCargoGlobal [_class, _count]};
        if (isClass (configFile >> "CfgVehicles" >> _class) && {_class isKindOf "Bag_Base"}) exitWith {_box addBackpackCargoGlobal [_class, _count]};
        if (isClass (configFile >> "CfgWeapons" >> _class)) exitWith {
            if (getNumber (configFile >> "CfgWeapons" >> _class >> "type") in [1, 2, 4, 5]) then {
                _box addWeaponCargoGlobal [_class, _count];
            } else {
                _box addItemCargoGlobal [_class, _count];
            };
        };
        throw format ["unknown item class: %1 (see GET /catalog, sections weapons, magazines, gear, backpacks)", _class];
    };
    _added = _added + _count;
} forEach _items;
[_id, _added]
