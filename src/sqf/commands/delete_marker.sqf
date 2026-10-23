if !(_name in allMapMarkers) then {throw format ["unknown marker: %1", _name]};
deleteMarker _name;
[_name]
