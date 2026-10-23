private _gun = _id call A3B_fnc_resolve;
if (_gun isEqualType grpNull) then {throw "artillery_fire expects the id of a gun or of its gunner, not a group"};
_gun = vehicle _gun;
private _magazines = getArtilleryAmmo [_gun];
if (_magazines isEqualTo []) then {throw format ["%1 is not artillery (no artillery ammunition)", typeOf _gun]};
if (isNull gunner _gun || {!alive gunner _gun}) then {throw "the gun has no living gunner"};
private _magazine = _magazines select 0;
if !(_pos inRangeOfArtillery [[_gun], _magazine]) then {throw "target out of range for this gun"};
_gun doArtilleryFire [_pos, _magazine, _rounds];
[_gun call A3B_fnc_id, _magazine, round (_gun getArtilleryETA [_pos, _magazine])]
