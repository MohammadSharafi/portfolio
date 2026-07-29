"""
Photoreal Cycles stills of the room, for the hero image and the OG card.

    blender --background --python scripts/blender/render_hero.py -- --samples 512
    blender --background --python scripts/blender/render_hero.py -- --view desk --width 2400

Output: scripts/blender/renders/<view>.png  (gitignored; copy the ones you want)

This is the other half of a deliberate split. The room the site ships is
real-time: it draws in a browser, on a phone, at 60 fps, which puts hard limits
on what a material is allowed to do — no refraction, no displacement, no
subsurface, and a lightmap standing in for global illumination. Those limits are
correct for the thing a visitor walks around in, and they are also the reason it
will never be mistaken for a photograph.

So the photographs are photographs. Same room, same script, same layout — but
rendered offline with everything the browser cannot afford, and shipped as
images. A hero shot, an OG card, a case-study still. Most portfolios that look
photoreal are doing exactly this and not saying so.

Nothing here changes the room. `photoreal_overrides` upgrades materials in the
render's own scene and is never exported.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(HERE, "renders")
# Written by the dev server's `screen-dump` endpoint; see vite.config.ts.
SCREEN_DIR = os.path.join(HERE, "screens")

sys.path.insert(0, HERE)


# (position, target, focal length in mm, f-stop) in Blender coordinates.
#
# Real focal lengths, not a field-of-view picked by eye. A 50 mm on full frame
# is the classic "sees what the eye sees" lens and the reason interiors shot on
# one look natural; the 24 mm establishing shot is what an architectural
# photographer would actually reach for, and its mild wide-angle stretch at the
# frame edges is part of why the result reads as a photograph.
VIEWS: dict[str, tuple[tuple[float, float, float], tuple[float, float, float], float, float]] = {
    "hero": ((3.05, 1.85, 1.62), (-0.60, -2.10, 0.95), 35.0, 2.8),
    "desk": ((1.15, -0.62, 1.16), (-0.30, -2.30, 0.86), 50.0, 2.0),
    # Close on the key block, from where a typist's eyes are. Purely for QA:
    # the legends address a grid atlas through per-cell UVs, and the failure
    # mode of that — a mirrored glyph, a row printed in the wrong place — is
    # invisible at any distance the room is actually seen from.
    "keyboard": ((-0.16, -1.74, 1.16), (-0.16, -1.93, 0.80), 50.0, 0.41),
    "shelf": ((2.30, 1.05, 1.45), (-3.00, 1.05, 1.20), 50.0, 2.5),
    "lounge": ((2.55, -0.35, 1.30), (0.10, 1.70, 0.55), 35.0, 2.8),
    "window": ((2.05, -0.75, 1.68), (2.05, -2.62, 1.62), 50.0, 4.0),
    # Straight on to the whiteboard, for reading what is printed on it.
    "board": ((-1.55, -1.35, 1.62), (-3.10, -1.35, 1.62), 50.0, 8.0),
    # 1200x630 crops out of this one.
    "og": ((3.35, 2.05, 1.55), (-0.45, -1.95, 0.92), 28.0, 3.5),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="render_hero")
    parser.add_argument("--view", default="hero", choices=sorted(VIEWS))
    parser.add_argument("--samples", type=int, default=512)
    parser.add_argument("--width", type=int, default=2000)
    parser.add_argument("--exposure", type=float, default=0.0)
    parser.add_argument("--no-dof", action="store_true", help="everything in focus")
    return parser.parse_args(argv)


def photoreal_overrides() -> int:
    """
    Upgrade materials to what the browser cannot afford.

    Everything here is a real-time compromise being paid off. The room's glass
    is an opaque dark quad because `MeshPhysicalMaterial.transmission` costs a
    render target per frame; its metals are flattened because a lightmap cannot
    carry a sharp reflection; its screens are unlit because they are painted
    with a canvas. Offline, none of that applies.

    Applied to the render's own scene only — this is never exported, so the
    shipped room is untouched.
    """
    import build_room

    upgraded = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        name = mat.name

        # Real glass: thickness, an accurate IOR and actual refraction.
        if name in ("screen_glass", "win_glass", "glass") or "glass" in name:
            bsdf.inputs["Transmission Weight"].default_value = 1.0
            bsdf.inputs["IOR"].default_value = 1.52
            bsdf.inputs["Roughness"].default_value = 0.02
            bsdf.inputs["Base Color"].default_value = (0.94, 0.96, 0.98, 1.0)
            upgraded += 1
            continue

        # A coat on anything moulded or painted. Injection-moulded plastic and
        # painted metal both have a thin specular layer over a diffuse body,
        # and it is most of why they photograph differently from bare pigment.
        if any(k in name for k in ("plastic", "keycap", "monitor_shell", "rack", "bezel", "drawer_face")):
            bsdf.inputs["Coat Weight"].default_value = 0.35
            bsdf.inputs["Coat Roughness"].default_value = 0.09
            upgraded += 1

        # Fabric gets sheen — cloth glows at grazing angles, and without it
        # upholstery reads as painted foam.
        if any(k in name for k in ("fabric", "sofa", "chair_", "rug", "hoodie", "throw", "pile", "wrist")):
            bsdf.inputs["Sheen Weight"].default_value = 0.55
            bsdf.inputs["Sheen Roughness"].default_value = 0.35
            upgraded += 1

        # Brushed metal stretches its highlight along the grain. Isotropic
        # roughness is what makes rendered aluminium look like grey plastic.
        if any(k in name for k in ("metal", "brushed", "arm", "castor_hub", "peg", "fret", "pull")):
            if bsdf.inputs["Metallic"].default_value > 0.3:
                bsdf.inputs["Anisotropic"].default_value = 0.65
                bsdf.inputs["Anisotropic Rotation"].default_value = 0.25
                upgraded += 1

        # Wood and paper are dielectrics with a little specular life in them.
        if any(k in name for k in ("desk", "wood", "shelf", "book", "paper", "board")):
            bsdf.inputs["Specular IOR Level"].default_value = 0.42
            upgraded += 1

    return upgraded


# Which dumped canvas belongs on which object, and whether that surface emits.
#
# Keyed by object name and mirroring `Screens.tsx`'s own TARGETS map, because
# these are the same surfaces: the browser paints them at runtime and this
# paints them for the render. A screen is a light source in the room and a
# whiteboard is paper, which is the whole difference between the two columns.
# (dumped image, emission, the orientation `screenContent.ts` baked into it).
#
# That last column is not decoration. The PNGs are the browser's own canvases,
# and `screenContent.finish` has already turned each one to suit three.js —
# differently per surface, because the quads face different ways. Blender needs
# that same turn applied *again* to undo it, plus one constant V flip for its
# own UV convention. Which collapses to: a `mirror-u` surface needs 180 degrees
# here, a `flip-v` surface needs nothing.
#
# A single blanket 180 was tried across all six. It reads correctly on the
# monitors and stands the whiteboard on its head — the diagram at the bottom,
# upside down, with the sticky notes inverted alongside it.
SCREENS: dict[str, tuple[str, float, str]] = {
    "ix_monitor_health_display": ("clinical", 2.6, "mirror-u"),
    "ix_monitor_code_display": ("code", 2.6, "mirror-u"),
    "ix_laptop_display": ("terminal", 2.2, "mirror-u"),
    "ix_whiteboard_face": ("whiteboard", 0.0, "flip-v"),
    "ix_sticky_notes": ("sticky", 0.0, "flip-v"),
    "ix_cv_face": ("cv", 0.0, "mirror-u"),
    # The legend atlas is a grid, so it is drawn pre-mirrored per cell and
    # needs no correction here — see `keycapTexture`.
    "ix_keycap_legends": ("keycap", 0.0, "flip-v"),
}


def paint_screens() -> int:
    """
    Put the site's own screen content on the screens.

    Without this every readable surface in the room renders black: they are
    `MeshBasicMaterial` carrying a canvas at runtime, and Cycles has neither.
    A hero shot of a developer's room with six dead monitors is not a hero shot.

    The images come from the running dev server via the `screen-dump` endpoint
    in `vite.config.ts`, so what renders here is what visitors actually see,
    down to the line of code on the editor — not a second implementation that
    drifts. Missing dumps are skipped with a warning rather than failing the
    render, since the wide views do not all show a screen.
    """
    if not os.path.isdir(SCREEN_DIR):
        print(f"[render_hero] no screen dumps in {SCREEN_DIR}; screens will render dark")
        return 0

    painted = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        # glTF splits multi-material meshes and suffixes them; the runtime
        # strips the same suffix for the same reason.
        base = re.sub(r"_\d+$", "", obj.name)
        entry = SCREENS.get(obj.name) or SCREENS.get(base)
        if entry is None:
            continue
        name, emission, orientation = entry
        path = os.path.join(SCREEN_DIR, f"{name}.png")
        if not os.path.exists(path):
            print(f"[render_hero] {obj.name} wants {name}.png, which is not there")
            continue

        # What the surface was made of before it was painted, so a printed
        # legend keeps the finish of the cap it is printed on. Hardcoding a
        # roughness here made every painted patch a slightly different material
        # from its surroundings, which on a monitor is invisible and on a 3 mm
        # keycap legend is a pale rectangle floating on the key.
        previous = obj.data.materials[0] if obj.data.materials else None
        inherited = {}
        if previous is not None and previous.use_nodes:
            old_bsdf = previous.node_tree.nodes.get("Principled BSDF")
            if old_bsdf is not None:
                inherited = {
                    key: old_bsdf.inputs[key].default_value
                    for key in ("Roughness", "Coat Weight", "Coat Roughness")
                    if key in old_bsdf.inputs
                }

        mat = bpy.data.materials.new(f"render_{name}")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path, check_existing=True)
        tex.interpolation = "Cubic"
        tex.location = (-400, 200)

        # Undo the turn the browser baked in. See `SCREENS`.
        if orientation == "mirror-u":
            flip = mat.node_tree.nodes.new("ShaderNodeMapping")
            flip.location = (-760, 200)
            flip.inputs["Location"].default_value = (1.0, 1.0, 0.0)
            flip.inputs["Scale"].default_value = (-1.0, -1.0, 1.0)
            coords = mat.node_tree.nodes.new("ShaderNodeTexCoord")
            coords.location = (-960, 200)
            mat.node_tree.links.new(coords.outputs["UV"], flip.inputs["Vector"])
            mat.node_tree.links.new(flip.outputs["Vector"], tex.inputs["Vector"])

        if emission > 0:
            # An emitting panel, so the picture goes to emission and the base
            # colour goes black: a monitor is not a lit surface showing an
            # image, it *is* the image, and leaving base colour in place would
            # add a diffuse copy of the UI on top of the glowing one.
            bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.28
            bsdf.inputs["Emission Strength"].default_value = emission
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        else:
            bsdf.inputs["Roughness"].default_value = inherited.get("Roughness", 0.62)
            for key, value in inherited.items():
                if key != "Roughness":
                    bsdf.inputs[key].default_value = value
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            # Alpha too, for atlases that are mostly empty. The keycap legends
            # draw only the marks and let the cap show through, which is the
            # only way a printed legend can carry the finish of the plastic it
            # is printed on.
            if tex.image.depth == 32:
                mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                mat.blend_method = "BLEND"

        obj.data.materials.clear()
        obj.data.materials.append(mat)
        painted += 1
    return painted


def add_camera(view: str, no_dof: bool) -> bpy.types.Object:
    position, target, focal, fstop = VIEWS[view]
    bpy.ops.object.camera_add(location=position)
    camera = bpy.context.object
    camera.name = f"hero_{view}"

    direction = Vector(target) - Vector(position)
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    # A full-frame sensor, so the focal lengths above mean what they say.
    camera.data.sensor_fit = "HORIZONTAL"
    camera.data.sensor_width = 36.0
    camera.data.lens = focal

    if not no_dof:
        # Focused on the subject, with a real aperture behind it. Depth of field
        # is the single strongest "this was photographed" cue there is — it is
        # evidence of a physical lens, and nothing in a game engine's default
        # output has it.
        camera.data.dof.use_dof = True
        camera.data.dof.focus_distance = direction.length
        camera.data.dof.aperture_fstop = fstop
        camera.data.dof.aperture_blades = 7

    bpy.context.scene.camera = camera
    return camera


def main() -> None:
    args = parse_args()

    import bake_room
    import build_room
    import numpy as np
    import tonemap

    build_room.build_all()
    build_room.texture_uvs()

    if not bake_room.ensure_cycles():
        sys.exit("Cycles could not be selected; enable it under Preferences > Add-ons.")

    # Paint first, upgrade second. `paint_screens` replaces a painted surface's
    # material outright, so running it after the upgrades threw them away — the
    # keycap legends came out as flat rectangles a shade lighter than the caps
    # they sit on, because the caps had the moulded-plastic coat and the quad
    # printed on them did not.
    print(f"[render_hero] painted {paint_screens()} screen(s) with the site's own content")
    upgraded = photoreal_overrides()
    print(f"[render_hero] upgraded {upgraded} material slot(s) beyond what the browser can draw")

    scene = bpy.context.scene
    bake_room.configure_cycles(args.samples, force_cpu=False, exposure=0.0)
    # Path tracing proper, not a bake. Deep enough that light gets around the
    # room the way it does in the real one — both wall washes face their walls,
    # so everything the room is lit by has already bounced at least once.
    scene.cycles.max_bounces = 24
    scene.cycles.diffuse_bounces = 16
    scene.cycles.glossy_bounces = 12
    scene.cycles.transmission_bounces = 16
    scene.cycles.use_denoising = True

    add_camera(args.view, args.no_dof)

    scene.render.resolution_x = args.width
    scene.render.resolution_y = int(args.width * 0.625)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    os.makedirs(OUT_DIR, exist_ok=True)
    raw = os.path.join(OUT_DIR, f"_{args.view}.exr")
    scene.render.filepath = raw
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    # Rendered raw and finished through the project's own curve, so a hero shot
    # and the shipped room agree about what the light looks like.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0

    print(f"[render_hero] rendering {args.view} at {args.width}px, {args.samples} samples")
    bpy.ops.render.render(write_still=True)

    rendered = bpy.data.images.load(raw)
    buffer = np.empty(rendered.size[0] * rendered.size[1] * rendered.channels, dtype=np.float32)
    rendered.pixels.foreach_get(buffer)
    pixels = buffer.reshape(-1, rendered.channels)
    print(f"[render_hero] peak scene-linear radiance {float(pixels[:, :3].max()):.2f}")

    finished = tonemap.apply(pixels, exposure=args.exposure)
    rendered.pixels.foreach_set(finished.reshape(-1))
    rendered.update()

    out = os.path.join(OUT_DIR, f"{args.view}.png")
    rendered.filepath_raw = out
    rendered.file_format = "PNG"
    rendered.save()
    os.remove(raw)
    print(f"[render_hero] wrote {out}")


if __name__ == "__main__":
    main()
