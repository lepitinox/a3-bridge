/*
 * Executes one command received from the extension and sends its result back.
 * _this: [request id (string), command name, positional arguments already validated by the extension]
 */
params ["_req", "_name", "_args"];
private _out = [];
try {
    private _fn = missionNamespace getVariable ("A3B_fnc_cmd_" + _name);
    if (isNil "_fn") then {throw format ["unknown command: %1", _name]};
    private _res = _args call _fn;
    if (isNil "_res") then {throw "script error while executing the command (see the RPT log)"};
    _out = [_req, true, _res];
} catch {
    _out = [_req, false, if (_exception isEqualType "") then {_exception} else {str _exception}];
};
["result", str _out] call A3B_fnc_send;
