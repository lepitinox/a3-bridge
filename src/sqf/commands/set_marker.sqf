if !(isClass (configFile >> "CfgMarkers" >> _type)) then {throw format ["unknown marker type: %1 (see GET /catalog, section marker_types)", _type]};
if !(isClass (configFile >> "CfgMarkerColors" >> _color)) then {throw format ["unknown marker color: %1 (see GET /catalog, section marker_colors)", _color]};

private _marker = _name;
if (_marker isEqualTo "auto") then {
    A3B_markerCounter = (missionNamespace getVariable ["A3B_markerCounter", 0]) + 1;
    _marker = "a3b_marker_" + (A3B_markerCounter toFixed 0);
};
// Same name: the existing marker is moved and restyled instead of duplicated.
if (_marker in allMapMarkers) then {
    _marker setMarkerPos _pos;
} else {
    if ((createMarker [_marker, _pos]) isEqualTo "") then {throw format ["could not create marker %1", _marker]};
};
_marker setMarkerShape toUpper _shape;
if (_shape isEqualTo "icon") then {_marker setMarkerType _type} else {_marker setMarkerBrush "Solid"};
_marker setMarkerText ([_text, ""] select (_text isEqualTo "none"));
_marker setMarkerColor _color;
_marker setMarkerSize [_size_x, _size_y];
_marker setMarkerDir _dir;
_marker setMarkerAlpha _alpha;
[_marker]
