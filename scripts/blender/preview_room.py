"""
Renders one Cycles still of the room from the camera the site opens on.

    blender --background --python scripts/blender/preview_room.py
    blender --background --python scripts/blender/preview_room.py -- --samples 64 --width 1200

Lighting is the one thing in this project that cannot be reasoned about in the
abstract. The bake takes minutes, ships a 9 MB GLB and needs a browser reload to
judge, which is far too slow a loop to balance a room by — the first version of
this room was lit by editing energies and re-baking blind, and it came out a
flat grey diorama because nobody could see what any single change did.

This renders the same scene, with the same lights, through the same tone map the
bake uses, from the camera stop in `src/room/data/objects.ts`. A 32-sample
preview lands in a few seconds and answers "is the wall violet yet".

Output: scripts/blender/preview.png (gitignored)
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "preview.png")

sys.path.insert(0, HERE)

# `HOME_STOP` from src/room/data/objects.ts, converted out of glTF space.
# glTF (x, y, z) is Blender (x, -z, y) — see scripts/blender/README.md.
HOME_POSITION_GLTF = (6.35, 4.7, -6.55)
HOME_TARGET_GLTF = (-0.22, 1.05, 0.85)
HOME_FOV_Y_DEG = 34.0


def gltf_to_blender(point: tuple[float, float, float]) -> Vector:
    x, y, z = point
    return Vector((x, -z, y))


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="preview_room")
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--exposure", type=float, default=0.0)
    parser.add_argument("--out", default=OUT)
    parser.add_argument(
        "--view",
        default="home",
        choices=("home", "desk", "shelf", "wide"),
        help="which camera stop to render from",
    )
    return parser.parse_args(argv)


# Extra angles, because a single three-quarter view hides half the room — the
# left wall's wash and the window's shaft are both invisible from the home stop.
VIEWS: dict[str, tuple[tuple[float, float, float], tuple[float, float, float], float]] = {
    "home": (gltf_to_blender(HOME_POSITION_GLTF)[:], gltf_to_blender(HOME_TARGET_GLTF)[:], 34.0),
    "desk": ((1.9, 2.4, 1.9), (0.1, -2.1, 1.1), 40.0),
    "shelf": ((3.4, 1.2, 2.6), (-3.0, 0.4, 1.4), 46.0),
    "wide": ((7.6, 7.4, 5.2), (0.0, -0.4, 1.2), 40.0),
}


def add_camera(view: str) -> None:
    position, target, fov_y = VIEWS[view]
    bpy.ops.object.camera_add(location=position)
    camera = bpy.context.object
    camera.name = "preview_camera"

    direction = Vector(target) - Vector(position)
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    camera.data.sensor_fit = "VERTICAL"
    camera.data.angle_y = math.radians(fov_y)
    bpy.context.scene.camera = camera


def main() -> None:
    args = parse_args()

    import bake_room
    import build_room

    build_room.build_all()
    build_room.texture_uvs()

    if not bake_room.ensure_cycles():
        sys.exit("Cycles could not be selected; open Blender and enable it under Preferences > Add-ons.")

    scene = bpy.context.scene
    bake_room.configure_cycles(args.samples, force_cpu=False, exposure=args.exposure)

    add_camera(args.view)

    scene.render.resolution_x = args.width
    scene.render.resolution_y = int(args.width * 10 / 16)
    scene.render.resolution_percentage = 100

    # Rendered to EXR and tone-mapped here rather than rendered straight to PNG
    # through one of Blender's view transforms.
    #
    # A preview whose highlights roll off differently from the atlas is worse
    # than no preview: it is a picture of a room the site will never show, and
    # balancing against it means every light is set to the wrong value. Filmic
    # and AgX are both close to the ACES fit in `tonemap` and neither is it. So
    # the render leaves Blender raw, and the one curve in this repo finishes it.
    raw = os.path.join(HERE, "_preview_raw.exr")
    scene.render.filepath = raw
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0

    print(f"[preview_room] rendering {args.view} at {args.samples} samples")
    bpy.ops.render.render(write_still=True)

    import numpy as np

    import tonemap

    rendered = bpy.data.images.load(raw)
    buffer = np.empty(rendered.size[0] * rendered.size[1] * rendered.channels, dtype=np.float32)
    rendered.pixels.foreach_get(buffer)
    pixels = buffer.reshape(-1, rendered.channels)
    print(f"[preview_room] peak scene-linear radiance {float(pixels[:, :3].max()):.2f}")

    finished = tonemap.apply(pixels, exposure=args.exposure)
    rendered.pixels.foreach_set(finished.reshape(-1))
    rendered.update()

    rendered.filepath_raw = args.out
    rendered.file_format = "PNG"
    rendered.save()
    os.remove(raw)
    print(f"[preview_room] wrote {args.out}")


if __name__ == "__main__":
    main()
