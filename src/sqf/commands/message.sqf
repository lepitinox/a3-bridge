// 0 = every machine; a side = every machine whose player is on that side.
private _target = if (_to isEqualTo "all") then {0} else {_to call A3B_fnc_sideFromName};
private _radioSide = if (_to isEqualTo "all") then {west} else {_target};
// Side chat only knows engine identities such as HQ, so another sender is written before the text.
private _radioText = if (_sender isEqualTo "HQ") then {_text} else {format ["%1 : %2", _sender, _text]};
switch (_kind) do {
    case "system": {_text remoteExec ["systemChat", _target]};
    case "hint": {_text remoteExec ["hint", _target]};
    case "title": {[_text, "PLAIN"] remoteExec ["titleText", _target]};
    case "side_chat": {[[_radioSide, "HQ"], _radioText] remoteExec ["sideChat", _target]};
    case "subtitle": {[_sender, _text] remoteExec ["BIS_fnc_showSubtitle", _target]};
};
[_to]
