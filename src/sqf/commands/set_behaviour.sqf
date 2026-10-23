private _grp = _id call A3B_fnc_groupOf;

if (_behaviour isNotEqualTo "unchanged") then {_grp setBehaviourStrong toUpper _behaviour};
if (_combat_mode isNotEqualTo "unchanged") then {_grp setCombatMode toUpper _combat_mode};
if (_speed_mode isNotEqualTo "unchanged") then {_grp setSpeedMode toUpper _speed_mode};
// Protocol names use "_" where the engine uses a space (stag_column -> STAG COLUMN).
if (_formation isNotEqualTo "unchanged") then {_grp setFormation toUpper (_formation splitString "_" joinString " ")};
if (_stance isNotEqualTo "unchanged") then {{_x setUnitPos toUpper _stance} forEach units _grp};
[_grp call A3B_fnc_id, toLower behaviour leader _grp, toLower combatMode _grp, toLower speedMode _grp, toLower formation _grp]
