/*
 * Converts a side to the protocol name (west, east, independent, civilian, unknown).
 */
switch (_this) do {
    case west: {"west"};
    case east: {"east"};
    case independent: {"independent"};
    case civilian: {"civilian"};
    default {"unknown"};
}
