/*
 * Deletes a group's waypoints (the engine always keeps waypoint 0, the starting point).
 */
for "_i" from (count waypoints _this - 1) to 1 step -1 do {deleteWaypoint [_this, _i]};
