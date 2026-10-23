"""Minimal PBO writer (uncompressed), the archive format Arma loads addons from.

Layout: a header entry carrying key/value properties, one header entry per file,
an empty terminating entry, the file data, then a zero byte and the SHA-1 of everything before it.
"""
import hashlib
import struct
import time
from pathlib import Path

VERS = 0x56657273  # "Vers": marks the property header entry


def _entry(name, method, original, timestamp, size):
    return name.encode("utf-8") + b"\0" + struct.pack("<5I", method, original, 0, timestamp, size)


def write_pbo(path, files, properties):
    """files: {"functions\\fn_x.sqf": bytes}; properties: {"prefix": "a3_bridge"}."""
    out = bytearray(_entry("", VERS, 0, 0, 0))
    for k, v in properties.items():
        out += k.encode() + b"\0" + v.encode() + b"\0"
    out += b"\0"
    now = int(time.time())
    for name, data in files.items():
        out += _entry(name, 0, len(data), now, len(data))
    out += _entry("", 0, 0, 0, 0)
    for data in files.values():
        out += data
    digest = hashlib.sha1(out).digest()
    Path(path).write_bytes(bytes(out) + b"\0" + digest)


def read_pbo(path):
    """Returns (properties, {name: bytes}); used to check what was packed."""
    raw = Path(path).read_bytes()
    pos = 0

    def cstr():
        nonlocal pos
        end = raw.index(b"\0", pos)
        s = raw[pos:end].decode("utf-8")
        pos = end + 1
        return s

    props, entries = {}, []
    while True:
        name = cstr()
        method, original, _, _, size = struct.unpack_from("<5I", raw, pos)
        pos += 20
        if method == VERS and name == "":
            while True:
                k = cstr()
                if not k:
                    break
                props[k] = cstr()
            continue
        if name == "":
            break
        entries.append((name, size))
    files = {}
    for name, size in entries:
        files[name] = raw[pos:pos + size]
        pos += size
    assert raw[pos] == 0 and hashlib.sha1(raw[:pos]).digest() == raw[pos + 1:pos + 21], "bad checksum"
    return props, files
