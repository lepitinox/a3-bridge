private _fn = compile _code;
if (_scheduled) exitWith {
    _args spawn _fn;
    ["spawned"]
};
private _r = _args call _fn;
// A nil result becomes null on the wire.
if (isNil "_r") exitWith {[nil]};
[_r]
