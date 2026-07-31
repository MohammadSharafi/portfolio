#!/usr/bin/env python3
"""World-space bounds for the room's interactive objects, read from the GLB.

Camera stops are hand-authored numbers pointed at objects that move whenever
`build_room.py` changes, and there is no way to eyeball whether a stop still
frames its subject — a stop that drifted 20 cm looks like a stop that was
always slightly wrong. This reads the truth out of the shipped asset: node
transforms composed down the hierarchy, POSITION accessor min/max per
primitive, so every box is where the browser will actually put it.

glTF is Y-up already (the exporter converted from Blender's Z-up), so these
numbers are directly comparable with the coordinates in `data/objects.ts`.

    python3 scripts/room_bounds.py [--json]
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

GLB = Path(__file__).resolve().parent.parent / "public" / "models" / "room.glb"

# Mirrors `toObjectId` in src/room/systems/objectId.ts: glTF splits a
# multi-material mesh into one node per material and suffixes the names, and a
# named sub-part belongs to its parent.
OBJECT_IDS = [
    "monitor-health",
    "monitor-code",
    "cv",
    "laptop",
    "notebook",
    "bookshelf",
    "whiteboard",
    "sticky-notes",
    "server-rack",
    "certificates",
    "lamp",
    "window",
    "mug",
    "headphones",
    "keyboard",
]


def to_object_id(name: str) -> str | None:
    if not name.startswith("ix_"):
        return None
    stem = re.sub(r"_\d+$", "", name[3:])
    parts = stem.split("_")
    for end in range(len(parts), 0, -1):
        candidate = "-".join(parts[:end])
        if candidate in OBJECT_IDS:
            return candidate
    return None


def read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise SystemExit(f"{path} is not a GLB")
    offset = 12
    gltf: dict | None = None
    buffer = b""
    while offset < len(raw):
        chunk_len, chunk_type = struct.unpack_from("<II", raw, offset)
        data = raw[offset + 8 : offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(data)
        elif chunk_type == 0x004E4942:
            buffer = data
        offset += 8 + chunk_len + (-chunk_len % 4)
    if gltf is None:
        raise SystemExit("no JSON chunk in GLB")
    return gltf, buffer


def identity() -> list[float]:
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def multiply(a: list[float], b: list[float]) -> list[float]:
    """Column-major 4x4 multiply, matching glTF's convention."""
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return out


def compose(node: dict) -> list[float]:
    if "matrix" in node:
        return list(node["matrix"])
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    qx, qy, qz, qw = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))

    x2, y2, z2 = qx + qx, qy + qy, qz + qz
    xx, xy, xz = qx * x2, qx * y2, qx * z2
    yy, yz, zz = qy * y2, qy * z2, qz * z2
    wx, wy, wz = qw * x2, qw * y2, qw * z2

    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0.0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0.0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0.0,
        tx, ty, tz, 1.0,
    ]


def apply(matrix: list[float], point: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = point
    return (
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    )


def collect(gltf: dict) -> dict[str, dict]:
    """Bounds per registry id, in world space."""
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    accessors = gltf.get("accessors", [])
    boxes: dict[str, list[float]] = {}
    names: dict[str, list[str]] = {}

    def visit(index: int, parent: list[float]) -> None:
        node = nodes[index]
        world = multiply(parent, compose(node))

        object_id = to_object_id(node.get("name", ""))
        if object_id is not None and "mesh" in node:
            for primitive in meshes[node["mesh"]].get("primitives", []):
                position = primitive.get("attributes", {}).get("POSITION")
                if position is None:
                    continue
                accessor = accessors[position]
                low = accessor.get("min")
                high = accessor.get("max")
                if not low or not high:
                    continue
                # Every corner, not just min/max: a rotated node's extremes are
                # not the transforms of the extremes.
                box = boxes.setdefault(
                    object_id, [float("inf")] * 3 + [float("-inf")] * 3
                )
                for cx in (low[0], high[0]):
                    for cy in (low[1], high[1]):
                        for cz in (low[2], high[2]):
                            wx, wy, wz = apply(world, (cx, cy, cz))
                            box[0] = min(box[0], wx)
                            box[1] = min(box[1], wy)
                            box[2] = min(box[2], wz)
                            box[3] = max(box[3], wx)
                            box[4] = max(box[4], wy)
                            box[5] = max(box[5], wz)
                names.setdefault(object_id, []).append(node.get("name", ""))

        for child in node.get("children", []):
            visit(child, world)

    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)]
    for root in scene.get("nodes", []):
        visit(root, identity())

    return {
        object_id: {
            "min": [round(v, 4) for v in box[:3]],
            "max": [round(v, 4) for v in box[3:]],
            "center": [round((box[i] + box[i + 3]) / 2, 4) for i in range(3)],
            "size": [round(box[i + 3] - box[i], 4) for i in range(3)],
            "meshes": sorted(set(names[object_id])),
        }
        for object_id, box in boxes.items()
    }


TS_HEADER = '''/**
 * Where every interactive object actually is, measured from `room.glb`.
 *
 * GENERATED — run `python3 scripts/room_bounds.py --ts` after re-exporting the
 * room. `bounds.test.ts` re-parses the GLB and fails if this file has drifted,
 * so a stale copy cannot ship.
 *
 * Camera stops used to be hand-authored positions and targets, and there was no
 * way to see that one had gone stale: an object moves in `build_room.py`, the
 * numbers pointed at where it used to be, and the result looks like a shot that
 * was always framed slightly badly. Three of them were aimed at empty space —
 * the notebook's target sat 70 cm to the left of the notebook. Stops are
 * derived from these boxes now, so re-exporting the room re-aims every camera.
 *
 * Coordinates are glTF space (Y-up), which is what the browser uses.
 */

export interface ObjectBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}

export const objectBounds = {
'''


def emit_ts(found: dict[str, dict]) -> str:
    rows = []
    for object_id in OBJECT_IDS:
        entry = found.get(object_id)
        if entry is None:
            continue
        def vec(key: str) -> str:
            return "[" + ", ".join(f"{v:g}" for v in entry[key]) + "]"
        rows.append(
            f"  '{object_id}': {{\n"
            f"    min: {vec('min')},\n"
            f"    max: {vec('max')},\n"
            f"    center: {vec('center')},\n"
            f"    size: {vec('size')},\n"
            f"  }},"
        )
    return (
        TS_HEADER
        + "\n".join(rows)
        + "\n} as const satisfies Record<string, ObjectBounds>;\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--ts", action="store_true", help="write src/room/data/objectBounds.ts")
    args = parser.parse_args()

    gltf, _buffer = read_glb(GLB)
    found = collect(gltf)

    if args.ts:
        root = Path(__file__).resolve().parent.parent
        out = root / "src" / "room" / "data" / "objectBounds.ts"
        out.write_text(emit_ts(found))

        # Hand it to Prettier rather than trying to emit Prettier's exact
        # output from Python. `npm run format:check` runs in CI and treats a
        # generated file no differently from a written one, so a generator that
        # formats by hand is a generator whose next small change breaks the
        # build for a reason that has nothing to do with the room. Best-effort:
        # if node_modules is not installed, the file is still correct, just
        # unformatted.
        try:
            subprocess.run(
                ["npx", "prettier", "--write", str(out)],
                cwd=root,
                check=True,
                capture_output=True,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            print(f"note: could not run prettier ({exc}); run it yourself", file=sys.stderr)

        print(f"wrote {out} ({len(found)} objects)")
        return 0

    if args.json:
        print(json.dumps(found, indent=2))
        return 0

    missing = [i for i in OBJECT_IDS if i not in found]
    for object_id in OBJECT_IDS:
        entry = found.get(object_id)
        if entry is None:
            print(f"{object_id:16} MISSING")
            continue
        c = entry["center"]
        s = entry["size"]
        print(
            f"{object_id:16} centre ({c[0]:7.3f} {c[1]:6.3f} {c[2]:7.3f})"
            f"  size ({s[0]:5.3f} {s[1]:5.3f} {s[2]:5.3f})"
        )
    if missing:
        print(f"\nnot in the GLB: {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
