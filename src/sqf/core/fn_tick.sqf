/*
 * Runs every frame on the machine that owns the scenario: executes pending commands,
 * flushes queued events and sends a state snapshot every A3B_cfg_state_interval_ms.
 */
// Commands arrive as one SQF array, split into "1..." parts while more follow and a final "0..." part.
private _buf = "";
private _guard = 0;
while {_guard < 1000} do {
    private _part = ("a3_bridge" callExtension ["poll", [A3B_cfg_max_commands_per_frame]]) select 0;
    if (_part isEqualTo "") exitWith {};
    _buf = _buf + (_part select [1]);
    if ((_part select [0, 1]) isEqualTo "0") exitWith {};
    _guard = _guard + 1;
};
if (_buf isNotEqualTo "") then {
    {_x call A3B_fnc_dispatch} forEach (parseSimpleArray _buf);
};

if (A3B_events isNotEqualTo []) then {
    private _events = A3B_events;
    A3B_events = [];
    ["events", str _events] call A3B_fnc_send;
};

if (diag_tickTime >= A3B_nextState) then {
    // Keep a fixed cadence regardless of frame boundaries; resync if the server fell far behind.
    private _interval = A3B_cfg_state_interval_ms / 1000;
    A3B_nextState = A3B_nextState + _interval;
    if (A3B_nextState < diag_tickTime) then {A3B_nextState = diag_tickTime + _interval};
    ["state", str (call A3B_fnc_state)] call A3B_fnc_send;
};

// Forget deleted entities every 10 seconds so the registry does not grow forever.
if (diag_tickTime >= A3B_nextPrune) then {
    A3B_nextPrune = diag_tickTime + 10;
    {A3B_registry deleteAt _x} forEach ((keys A3B_registry) select {isNull (A3B_registry get _x)});
    A3B_objects = A3B_objects select {!isNull _x};
};
