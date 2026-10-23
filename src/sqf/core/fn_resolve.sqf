/*
 * Returns the object or group registered under a bridge id. Throws when the id is unknown or its entity is gone.
 */
private _e = A3B_registry getOrDefault [_this, objNull];
if (isNull _e) then {throw format ["unknown or deleted id: %1", _this]};
_e
