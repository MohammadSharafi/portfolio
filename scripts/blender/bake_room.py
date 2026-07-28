"""
Bakes the room's lighting into a texture atlas and exports the baked model.

    blender --background --python scripts/blender/bake_room.py
    blender --background --python scripts/blender/bake_room.py -- --size 2048 --samples 128

This one needs a real Blender install. Baking requires Cycles, and the `bpy`
PyPI wheel ships EEVEE Next only — `bpy.ops.object.bake` there returns
"Current render engine does not support baking". The script checks up front and
says so rather than failing halfway through a render.

Why bother: baking is the single largest quality lever in a scene like this. It
resolves every bounce, every soft shadow and every bit of colour bleed once, at
render quality, and writes the result into one image. The browser then draws the
room with unlit materials — no lights, no shadow maps, no per-pixel lighting at
all — which is both better looking and dramatically cheaper than anything the
GPU could compute in a frame budget. It is the whole reason a room like this can
hold 120fps on a laptop.

Output, deployed:
    public/models/room-baked.glb   the model, atlas packed inside it as JPEG
    public/models/room-baked.json  which room.glb this was baked from

Output, local only:
    scripts/blender/room-bake.png  the atlas as a standalone file, gitignored

The runtime prefers room-baked.glb when it is present and falls back to the
real-time lit room.glb when it is not, so running this is an upgrade rather than
a requirement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "models")
OUT_LIGHTMAP = os.path.join(OUT_DIR, "room-lightmap.jpg")
# Deliberately not under public/. The atlas the browser draws is the JPEG the
# glTF exporter packs into OUT_GLB; nothing on the site ever fetches this file.
# It is written so a human can open the atlas to inspect UV packing or lighting,
# and so `--reuse-atlas` can re-export without re-baking. Left in public/ it was
# 13 MB of dead weight in every deploy.
OUT_PNG = os.path.join(HERE, "room-bake.png")
# The bake's own output, before any view transform: scene-linear radiance at
# full float precision. This is what `--reuse-atlas` re-encodes from, and it has
# to be the raw one — see `write_lightmap_from_raw`. Gitignored; it is large.
OUT_RAW = os.path.join(HERE, "room-bake.exr")
OUT_STAMP = os.path.join(OUT_DIR, "room-lightmap.json")

sys.path.insert(0, HERE)


def parse_args() -> argparse.Namespace:
    # Blender passes its own argv; everything after a bare `--` is ours.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="bake_room")
    parser.add_argument("--size", type=int, default=4096, help="atlas resolution")
    parser.add_argument("--samples", type=int, default=256, help="Cycles samples")
    parser.add_argument("--cpu", action="store_true", help="force CPU rendering")
    parser.add_argument(
        "--saturation",
        type=float,
        default=1.12,
        help="chroma restored after the filmic curve; 1.0 leaves it desaturated",
    )
    parser.add_argument(
        "--reuse-atlas",
        action="store_true",
        help="re-export from the existing room-bake.png instead of baking again",
    )
    parser.add_argument(
        "--exposure",
        type=float,
        default=0.0,
        help="stops of exposure applied to the bake; +1 doubles the brightness",
    )
    return parser.parse_args(argv)


def cycles_module_present() -> bool:
    """Cheap up-front check that the add-on ships with this build at all."""
    try:
        import addon_utils

        return any(module.__name__ == "cycles" for module in addon_utils.modules())
    except Exception:
        return False


def ensure_cycles() -> bool:
    """
    Enable Cycles and confirm the engine can actually be selected.

    Two things make this less obvious than it looks. Reading the engine list off
    the RNA definition returns a static enum that does not reflect engines
    registered at runtime, so the only honest test is to assign the engine and
    see whether it takes. And `read_factory_settings()` resets preferences,
    which disables the add-on again — so this has to run *after* the scene is
    built, not before it.
    """
    try:
        import addon_utils

        addon_utils.enable("cycles", default_set=True, persistent=True)
    except Exception as exc:  # pragma: no cover - depends on the install
        print(f"[bake_room] could not enable the Cycles add-on: {exc}", file=sys.stderr)

    try:
        bpy.context.scene.render.engine = "CYCLES"
    except (TypeError, AttributeError):
        return False
    return bpy.context.scene.render.engine == "CYCLES"


def configure_cycles(samples: int, force_cpu: bool, exposure: float = 0.0) -> None:
    scene = bpy.context.scene
    scene.cycles.samples = samples
    # Exposure and the rest of the view transform are applied by `tonemap.apply`
    # after the bake, not by Blender. Baking ignores `view_settings` entirely —
    # it writes raw scene-linear radiance into the image — so setting exposure
    # here did nothing at all to the shipped atlas, which is why the knob never
    # appeared to work.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.cycles.use_denoising = True

    # A lightmap, not a finished image.
    #
    # COMBINED bakes light *times* albedo into one picture, which the runtime
    # then had to draw with an unlit material — and that is why nothing in the
    # room looked like its material. Glass, plastic, wood and cotton all became
    # the same flat painted colour, because an unlit shader has no roughness
    # response, no specular and no fresnel to tell them apart with.
    #
    # DIFFUSE with the colour pass *off* bakes incoming irradiance alone. The
    # model keeps its real base colour, roughness, metalness and normal maps,
    # and the runtime multiplies this in through three.js's `lightMap` slot. The
    # lighting is still resolved once, at render quality, and free at runtime —
    # but a glossy surface can now be glossy.
    scene.cycles.bake_type = "DIFFUSE"
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    # No selected-to-active projection: every object bakes its own lighting into
    # its own islands of the shared atlas.
    scene.render.bake.use_selected_to_active = False
    # Margin bleeds the bake past each island's edge so bilinear filtering at
    # the seams samples lit texels rather than background.
    scene.render.bake.margin = 8

    if force_cpu:
        scene.cycles.device = "CPU"
        return

    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs is None:
        scene.cycles.device = "CPU"
        return

    cprefs = prefs.preferences
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            cprefs.compute_device_type = backend
        except TypeError:
            continue
        cprefs.get_devices()
        if any(device.type == backend for device in cprefs.devices):
            for device in cprefs.devices:
                device.use = device.type in (backend, "CPU")
            scene.cycles.device = "GPU"
            print(f"[bake_room] GPU backend: {backend}")
            return

    scene.cycles.device = "CPU"
    print("[bake_room] no GPU backend found, baking on CPU")


def bake_in_batches(meshes: list[bpy.types.Object], *, batch: int = 8) -> None:
    """
    Bakes every object into the shared atlas, a handful at a time, reporting as
    it goes.

    Baking all of them in one `bpy.ops.object.bake` call is equivalent and one
    line shorter — each object writes only its own islands either way, and only
    the first batch clears. What one call cannot do is say how far along it is,
    and at a 4096 atlas this takes the better part of an hour on a laptop GPU.
    A silent forty-minute operator is indistinguishable from a hung one.

    `use_clear` on the first batch only. Clearing per batch would wipe the
    islands the previous batches had just written and leave an atlas holding
    nothing but the last eight objects.
    """
    started = time.monotonic()

    for index in range(0, len(meshes), batch):
        chunk = meshes[index : index + batch]

        bpy.ops.object.select_all(action="DESELECT")
        for obj in chunk:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = chunk[0]

        bpy.ops.object.bake(type="COMBINED", use_clear=index == 0)

        done = index + len(chunk)
        elapsed = time.monotonic() - started
        remaining = elapsed / done * (len(meshes) - done)
        print(
            f"[bake_room] {done}/{len(meshes)} objects · "
            f"{elapsed / 60:.1f} min elapsed · ~{remaining / 60:.1f} min left",
            flush=True,
        )


def finish_atlas(atlas: bpy.types.Image, path: str, *, exposure: float, saturation: float) -> float:
    """
    Writes the lightmap JPEG and a tone-mapped PNG to look at. Returns the scale
    the runtime has to multiply the lightmap back up by.

    The JPEG is *not* a picture. It is irradiance — a physical quantity the
    browser multiplies into each material's own albedo — so it must not have a
    view transform baked into it. Applying the filmic curve here and then
    letting `RoomExperience` apply ACES again to the finished frame runs the
    room through two tone maps, and two tone maps is very nearly black: the
    curve's shoulder rolls midtones down toward 0.5, and doing that twice puts
    the whole room in the bottom quarter of the range. That is exactly what the
    first lightmap build looked like.

    So the curve is applied once, in the renderer, to the assembled frame. What
    ships here is the raw quantity, and the only transform on it is the one
    forced by the container: a JPEG holds [0,1], irradiance does not, so the
    values are divided down by `scale` and the runtime multiplies back.

    `foreach_get` rather than slicing `atlas.pixels`: the property is a
    bpy_prop_array, and indexing it element-by-element to read a 4096² atlas
    means 67 million individual Python-to-RNA round trips. That version took
    long enough to look like a hang.
    """
    import numpy as np

    import tonemap

    width, height = atlas.size
    buffer = np.empty(width * height * atlas.channels, dtype=np.float32)
    atlas.pixels.foreach_get(buffer)

    pixels = buffer.reshape(-1, atlas.channels)
    rgb = pixels[:, :3]
    peak = float(rgb.max()) if len(pixels) else 0.0

    # The divisor is the 99.5th percentile, not the peak. The peak belongs to
    # the handful of texels *on* a lamp's own shade, which are hundreds of times
    # brighter than the room they light; normalising by that would push every
    # real surface into the bottom two or three sRGB code values and the room
    # would band like a gradient in an old GIF. Clipping those few texels costs
    # nothing — a lamp shade is emissive at runtime anyway, drawn by the
    # emissive pass rather than by its lightmap.
    lit = rgb[rgb > 0.0]
    scale = float(np.percentile(lit, 99.5)) if lit.size else 1.0
    scale = max(scale, 1e-3)
    clipped = float((rgb > scale).mean() * 100.0)

    # sRGB storage, so the 8 bits available are spent where the eye can see the
    # steps — a linear 8-bit lightmap bands visibly in the shadows.
    normalised = np.clip(rgb / scale, 0.0, 1.0)

    # Round-tripping through `images.load` fails with "does not have any image
    # data": the load is lazy and neither `reload` nor a save forces the buffer
    # in reliably. Handing Blender an 8-bit image and the display-linear values
    # avoids the file entirely — and an 8-bit image, unlike a float one, does
    # get the sRGB transform applied on save.
    out = bpy.data.images.new("room_lightmap", width, height, float_buffer=False)
    out.colorspace_settings.name = "sRGB"
    rgba = np.concatenate([normalised, np.ones((len(normalised), 1), dtype=np.float32)], axis=-1)
    out.pixels.foreach_set(rgba.reshape(-1))
    out.update()
    out.filepath_raw = OUT_LIGHTMAP
    out.file_format = "JPEG"
    out.save()
    print(f"[bake_room] wrote {OUT_LIGHTMAP} ({os.path.getsize(OUT_LIGHTMAP) / 1024 / 1024:.1f} MB)")

    # Keep the radiance itself, so re-encoding never needs another bake. Saved
    # only when this atlas came from a bake — when it *is* the reloaded EXR,
    # rewriting it under itself would be pointless and briefly destructive.
    if os.path.abspath(atlas.filepath_raw or "") != os.path.abspath(OUT_RAW):
        atlas.filepath_raw = OUT_RAW
        atlas.file_format = "OPEN_EXR"
        atlas.save()

    # The PNG is the opposite: nobody multiplies it by anything, it exists to be
    # looked at, so it gets the full view transform.
    finished = tonemap.apply(pixels, exposure=exposure, saturation=saturation)
    rgb8 = tonemap.encode_srgb(finished[:, :3]).reshape(height, width, 3)
    # Blender's buffer runs bottom-up; PNG scanlines run top-down.
    tonemap.write_png(path, rgb8[::-1])

    # The peak is the one number worth printing. Below about 1.5 the room has no
    # highlights for the curve to work on and the lights want turning up; in the
    # hundreds, something is emitting far more than it should.
    print(f"[bake_room] peak radiance {peak:.2f}, stored at 1/{scale:.3f} ({clipped:.2f}% clipped)")
    return scale


def prepare_materials(atlas: bpy.types.Image, build_room) -> list[bpy.types.Object]:
    """
    Gives every material an Image Texture node pointing at the shared atlas and
    makes it active, which is where Cycles writes.
    """
    # The same set `unwrap_all` gave Bake UVs to. Anything excluded there has no
    # island in the atlas, so baking it would write over someone else's texels.
    meshes = build_room.bake_meshes()

    for obj in meshes:
        if "Bake" in obj.data.uv_layers:
            obj.data.uv_layers.active = obj.data.uv_layers["Bake"]

        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or not mat.use_nodes:
                continue
            node = next(
                (
                    n
                    for n in mat.node_tree.nodes
                    if n.type == "TEX_IMAGE" and n.image == atlas
                ),
                None,
            )
            if node is None:
                node = mat.node_tree.nodes.new("ShaderNodeTexImage")
                node.image = atlas
                node.location = (-900, 400)
            node.select = True
            mat.node_tree.nodes.active = node

    return meshes


def write_lightmap_from_raw(source_exr: str, *, exposure: float, saturation: float) -> float:
    """
    Re-encode a previously baked atlas without re-baking it.

    Reads the *raw radiance* EXR, not the tone-mapped PNG. That distinction is
    the whole reason this function exists in this form: the PNG has the view
    transform baked into it, so re-deriving the lightmap from it would ship a
    tone-mapped lightmap, the browser would tone-map the frame again, and the
    room would come back crushed to black — the exact bug this pipeline just
    had. Reusing the PNG made that failure a one-flag mistake anyone could make
    months later with no way to see it coming.

    No second GLB any more. `room.glb` already carries the bake UVs on
    TEXCOORD_1 and real base-colour, roughness and normal maps, so the only
    thing the bake needs to add is the lighting — one image the runtime hangs
    on `material.lightMap`.

    JPEG because it is the whole download and a lightmap is the ideal subject:
    broad smooth gradients, no text, no hard edges except at island borders,
    which the bleed margin already softens.
    """
    image = bpy.data.images.load(source_exr, check_existing=False)
    # `load` is lazy: it records the path and reads nothing, so touching the
    # pixels straight afterwards fails with "does not have any image data".
    # `reload` is what actually pulls them in.
    image.reload()
    return finish_atlas(image, OUT_PNG, exposure=exposure, saturation=saturation)


def stamp_source(scale: float = 1.0) -> None:
    """Records which room.glb this bake came from, so a stale one is ignored."""
    # Record which room this was baked from.
    #
    # The runtime prefers the baked model over the live one, so a bake that has
    # fallen behind does not degrade the site quietly — it *replaces* it with an
    # older room, and every change made since becomes invisible. That has now
    # happened twice, and both times the room looked broken in ways the code
    # said were already fixed.
    #
    # The fix is not to remember to re-bake. It is for the baked model to carry
    # the fingerprint of the room it came from, so the runtime can notice and
    # fall back on its own.
    source = os.path.join(OUT_DIR, "room.glb")
    stamp = {
        "source": hashlib.sha256(open(source, "rb").read()).hexdigest() if os.path.exists(source) else "",
        "baked": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        # What `lightMapIntensity` has to be for the room to be lit as it was
        # rendered. Two factors, and both are easy to lose:
        #
        #   `scale`, undoing the divide that squeezed irradiance into a JPEG.
        #
        #   π, because Cycles and three.js disagree about where it lives.
        #   Blender's colour-free DIFFUSE pass already carries the 1/π of the
        #   Lambert BRDF, so albedo × bake is the outgoing radiance. three.js
        #   applies its own RECIPROCAL_PI to whatever the lightMap yields, so
        #   handing it Blender's number divides by π a second time and the room
        #   comes out 3.14× too dark — dim enough to read as "the lights need
        #   turning up" and send you off adjusting wattages that were right.
        "intensity": math.pi * scale,
    }
    with open(OUT_STAMP, "w", encoding="utf-8") as handle:
        json.dump(stamp, handle, indent=2)
        handle.write("\n")
    print(f"[bake_room] wrote {OUT_STAMP} (source {stamp['source'][:12]}…)")


def main() -> None:
    args = parse_args()

    if not cycles_module_present():
        sys.exit(
            "This Blender build does not ship the Cycles add-on, so nothing can\n"
            "be baked. If this is the `bpy` PyPI module it never will; use the\n"
            "Blender application instead."
        )

    import build_room

    # Built from the script, exactly like the plain export.
    #
    # This briefly read `assets/room.blend` instead, from a spell when the room
    # was going to be modelled by hand. That file is no longer in the repo, so
    # the bake either died on a clean clone or — worse, and what actually
    # happened — silently loaded a stale leftover copy and baked a room several
    # weeks of work out of date, which the site then preferred over the current
    # one. Whatever the export ships, the bake has to bake.
    build_room.build_all()

    # The same texture UVs the shipped model uses. Without this the grain maps
    # are sampled through whatever UVs each primitive was born with — every cube
    # face its own 0..1 square — so a bake would resolve wood grain at the size
    # of a floorboard on a coffee mug and freeze it into the atlas permanently.
    build_room.texture_uvs()

    # Materials now carry generated image maps, wired at build time, so there is
    # normally nothing left for this to do — it reports 0 and that is correct.
    # It stays for the case where a material is tagged with a `grain` property
    # but has no maps, which is what a hand-authored material added in Blender
    # would look like.
    applied = build_room.apply_grain()
    print(f"[bake_room] {applied} material(s) needed procedural grain; the rest already carry maps")

    build_room.unwrap_all()

    os.makedirs(OUT_DIR, exist_ok=True)

    if args.reuse_atlas:
        # Re-export without re-baking.
        #
        # The bake takes the better part of an hour, and plenty of reasons to
        # re-export have nothing to do with the lighting — changing the texture
        # encoding, or fixing a name the runtime looks up. Paying for a bake to
        # do either is what makes people avoid touching the pipeline at all.
        # Only valid while the geometry and its UVs are unchanged.
        if not os.path.exists(OUT_RAW):
            sys.exit(
                f"--reuse-atlas needs the raw radiance atlas, and {OUT_RAW} is not there.\n"
                "Bake once without the flag to produce it."
            )
        print(f"[bake_room] reusing {OUT_RAW}; nothing was baked")
        scale = write_lightmap_from_raw(OUT_RAW, exposure=args.exposure, saturation=args.saturation)
        stamp_source(scale)
        return

    if not ensure_cycles():
        sys.exit(
            "Cycles could not be selected as the render engine.\n"
            "Open Blender normally, enable Cycles under Preferences > Add-ons,\n"
            "save preferences, then run this again."
        )
    print("[bake_room] Cycles enabled")

    configure_cycles(args.samples, args.cpu, args.exposure)

    # A float buffer, not the 8-bit one this used to bake into.
    #
    # An 8-bit image clamps on write, so every value above 1.0 was destroyed the
    # moment Cycles produced it — before anything could roll it off. That is
    # what made the lamp, the screens and both LED strips ship as identical flat
    # white shapes, and per-channel clipping shifted warm highlights' hue on the
    # way there. The float buffer keeps the full range so `tonemap.apply` has
    # something left to compress.
    atlas = bpy.data.images.new("room_bake", args.size, args.size, float_buffer=True)
    meshes = prepare_materials(atlas, build_room)

    print(f"[bake_room] baking {len(meshes)} objects at {args.size}px, {args.samples} samples")
    bake_in_batches(meshes)

    os.makedirs(OUT_DIR, exist_ok=True)
    scale = finish_atlas(atlas, OUT_PNG, exposure=args.exposure, saturation=args.saturation)
    print(f"[bake_room] wrote {OUT_PNG} ({os.path.getsize(OUT_PNG) / 1024 / 1024:.1f} MB)")

    # No rewiring. The materials keep their own base colour, roughness, metalness
    # and normal maps — that is the entire point of a lightmap over a combined
    # bake, and pointing base colour at the atlas would throw them away again.
    stamp_source(scale)
    print("[bake_room] done — room.glb plus the lightmap are what the site loads")


if __name__ == "__main__":
    main()
