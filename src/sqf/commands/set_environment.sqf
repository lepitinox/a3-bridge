if (_time >= 0) then {
    private _hours = _time min 23.99;
    private _date = date;
    _date set [3, floor _hours];
    _date set [4, floor ((_hours - floor _hours) * 60)];
    setDate _date;
};
if (_overcast >= 0) then {_transition setOvercast _overcast};
if (_fog >= 0) then {_transition setFog _fog};
if (_rain >= 0) then {_transition setRain _rain};
if (_transition == 0 && {_overcast >= 0 || {_rain >= 0}}) then {forceWeatherChange};
[dayTime, overcast, rain, fog]
