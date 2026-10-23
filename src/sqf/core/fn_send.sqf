/*
 * Sends a text to the extension in chunks, then commits it under a kind (state, events or result).
 * Chunking keeps every callExtension argument small whatever the size of the scenario.
 */
params ["_kind", "_text"];
private _n = count _text;
private _i = 0;
while {_i < _n} do {
    "a3_bridge" callExtension ["chunk", [_text select [_i, A3B_cfg_chunk_size]]];
    _i = _i + A3B_cfg_chunk_size;
};
"a3_bridge" callExtension ["commit", [_kind]];
