/*
 * Test mission: every connected player gets a Zeus interface (key Y), also after respawn,
 * and everything on the map (including what the bridge creates) stays editable in Zeus.
 */
A3B_test_curators = [];

[] spawn {
    while {true} do {
        {
            private _unit = _x;
            if (alive _unit && {isNull getAssignedCuratorLogic _unit}) then {
                private _free = A3B_test_curators select {isNull getAssignedCuratorUnit _x};
                private _curator = if (_free isNotEqualTo []) then {
                    _free select 0
                } else {
                    private _c = (createGroup sideLogic) createUnit ["ModuleCurator_F", [0, 0, 0], [], 0, "NONE"];
                    _c setVariable ["Addons", 3, true];
                    _c setVariable ["showNotification", false, true];
                    _c addCuratorAddons activatedAddons;
                    _c setCuratorCoef ["Place", 0];
                    _c setCuratorCoef ["Delete", 0];
                    A3B_test_curators pushBack _c;
                    _c
                };
                unassignCurator _curator;
                _unit assignCurator _curator;
                diag_log format ["[a3b_test] Zeus given to %1 (%2)", name _unit, _unit];
            };
        } forEach (allPlayers - entities "HeadlessClient_F");

        private _editable = allUnits + vehicles + allDeadMen + (missionNamespace getVariable ["A3B_objects", []]);
        {_x addCuratorEditableObjects [_editable, true]} forEach A3B_test_curators;
        sleep 2;
    };
};
