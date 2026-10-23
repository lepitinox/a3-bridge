/*
 * Converts a protocol side name back to a side. Throws on unknown names.
 */
private _i = ["west", "east", "independent", "civilian"] find _this;
if (_i < 0) then {throw format ["unknown side: %1", _this]};
[west, east, independent, civilian] select _i
