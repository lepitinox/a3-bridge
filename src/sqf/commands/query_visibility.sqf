private _eye = (AGLToASL _from) vectorAdd [0, 0, _from_height];
private _spot = (AGLToASL _to) vectorAdd [0, 0, _to_height];
// checkVisibility accounts for buildings, objects and vegetation (0 = hidden, 1 = fully visible).
private _visibility = [objNull, "VIEW", objNull] checkVisibility [_eye, _spot];
[
    (round (_visibility * 100)) / 100,
    terrainIntersectASL [_eye, _spot],
    round (_eye distance _spot),
    round ((_eye select 2) - (_spot select 2))
]
