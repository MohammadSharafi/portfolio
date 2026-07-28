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

Output:
    public/models/room-baked.glb   the model, materials pointing at the atlas
    public/models/room-bake.png    the atlas itself
    public/models/room-baked.json  which room.glb this was baked from

The runtime prefers room-baked.glb when it is present and falls back to the
real-time lit room.glb when it is not, so running this is an upgrade rather than
a requirement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "models")
OUT_GLB = os.path.join(OUT_DIR, "room-baked.glb")
OUT_PNG = os.path.join(OUT_DIR, "room-bake.png")
OUT_STAMP = os.path.join(OUT_DIR, "room-baked.json")

sys.path.insert(0, HERE)


def parse_args() -> argparse.Namespace:
    # Blender passes its own argv; everything after a bare `--` is ours.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="bake_room")
    parser.add_argument("--size", type=int, default=4096, help="atlas resolution")
    parser.add_argument("--samples", type=int, default=256, help="Cycles samples")
    parser.add_argument("--cpu", action="store_true", help="force CPU rendering")
    parser.add_argument(
        "--exposure",
        type=float,
        default=0.0,
        help="stops of exposure applied to the bake; +1 doubles the brightness",
    )
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
    scene.cycles.use_denoising = True
    scene.cycles.bake_type = "COMBINED"

    # Exposure and the rest of the view transform are applied by `tonemap.apply`
    # after the bake, not by Blender. Baking ignores `view_settings` entirely —
    # it writes raw scene-linear radiance into the image — so setting exposure
    # here did nothing at all to the shipped atlas, which is why the knob never
    # appeared to work.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0

    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    # No selected-to-active projection: every object bakes its own lighting into
    # its own islands of the shared atlas.
    scene.render.bake.use_selected_to_active = False
    # Margin bleeds the bake past each island's edge so bilinear filtering at
    # the seams samples lit texels rather than background.
    scene.render.bake.margin = 12

    # A practical-lit room is mostly indirect light: the violet wall wash and
    # the cyan one both face their walls, so the room only ever sees them at
    # second hand. Blender's default 4 diffuse bounces clips exactly the light
    # this room is made of, and the corners go muddy.
    scene.cycles.max_bounces = 16
    scene.cycles.diffuse_bounces = 12
    scene.cycles.glossy_bounces = 6
    scene.cycles.transmission_bounces = 8

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


def bake_in_batches(meshes: list[bpy.types.Object], *, size: int, batch: int = 8) -> None:
    """
    Bakes every object into the shared atlas, a handful at a time, reporting as
    it goes.

    Baking all of them in one `bpy.ops.object.bake` call is equivalent and one
    line shorter — each object writes only its own islands either way, and only
    the first batch clears. What one call cannot do is say how far along it is,
    and at a 4096 atlas this takes tens of minutes on a laptop GPU. A silent
    forty-minute operator is indistinguishable from a hung one, which is exactly
    how the first high-resolution bake was read: there was no way to tell whether
    it was nearly done or had wedged, so the only options were to keep waiting or
    throw the work away.

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
        # A rate-based estimate rather than a percentage: objects differ enormously
        # in how long they take, but the estimate is still the difference between
        # "wait" and "kill it".
        remaining = elapsed / done * (len(meshes) - done)
        print(
            f"[bake_room] {done}/{len(meshes)} objects · "
            f"{elapsed / 60:.1f} min elapsed · ~{remaining / 60:.1f} min left",
            flush=True,
        )


def finish_atlas(atlas: bpy.types.Image, path: str, *, exposure: float, saturation: float) -> None:
    """
    Runs the baked radiance through the filmic curve and writes the atlas PNG.

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
    peak = float(pixels[:, :3].max()) if len(pixels) else 0.0

    finished = tonemap.apply(pixels, exposure=exposure, saturation=saturation)
    rgb8 = tonemap.encode_srgb(finished[:, :3]).reshape(height, width, 3)
    # Blender's buffer runs bottom-up; PNG scanlines run top-down.
    tonemap.write_png(path, rgb8[::-1])

    # The peak is the one number worth printing. Below about 1.5 the room has no
    # highlights for the curve to do anything with and the lights want turning
    # up; in the hundreds, something is emitting far more than it should and the
    # whole image will tone-map down around it.
    print(f"[bake_room] peak scene-linear radiance {peak:.2f}, tone-mapped at {exposure:+.2f} stops")


def prepare_materials(atlas: bpy.types.Image) -> list[bpy.types.Object]:
    """
    Gives every material an Image Texture node pointing at the shared atlas and
    makes it active, which is where Cycles writes.
    """
    # Having a Bake UV layer *is* the definition of taking part: `unwrap_all`
    # gives one to exactly the meshes `build_room.lightmapped` accepts. Deriving
    # the list rather than re-deriving the rule means the two cannot drift.
    meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and "Bake" in obj.data.uv_layers
    ]

    for obj in meshes:
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


def rewire_to_baked(
    atlas: bpy.types.Image, meshes: list[bpy.types.Object], finished: bpy.types.Image | None = None
) -> None:
    """
    Repoints every material at the atlas.

    `finished` is the 8-bit sRGB file the bake was written out to; when given,
    the texture nodes are moved onto it and the float buffer `atlas` is left
    behind. The float buffer exists only so the tone map had headroom to work
    in, and shipping it would mean exporting a 16-bit image of linear values.

    The lighting now lives in the texture, so the base colour *is* the finished
    pixel. Roughness and metallic are flattened to matte — leaving them would
    have the browser add a second specular response on top of one already baked
    in, which reads as a greasy sheen over everything.
    """
    seen: set[str] = set()
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen or not mat.use_nodes:
                continue
            seen.add(mat.name)

            nodes = mat.node_tree.nodes
            links = mat.node_tree.links
            bsdf = nodes.get("Principled BSDF")
            tex = next((n for n in nodes if n.type == "TEX_IMAGE" and n.image == atlas), None)
            if bsdf is None or tex is None:
                continue
            if finished is not None:
                tex.image = finished

            uv = nodes.new("ShaderNodeUVMap")
            uv.uv_map = "Bake"
            uv.location = (-1100, 400)
            links.new(uv.outputs["UV"], tex.inputs["Vector"])
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

            # Unlink before setting, or the value is ignored and the map wins.
            # The grain maps are now wired into roughness and normal at build
            # time, and a link left in place would ship a roughness map and a
            # normal map inside the baked GLB — several hundred kilobytes of
            # data addressed through the atlas's UVs, which are not the UVs it
            # was authored against, describing a lighting response the browser
            # does not compute because the baked room draws unlit.
            for socket in ("Roughness", "Normal"):
                for link in list(bsdf.inputs[socket].links):
                    mat.node_tree.links.remove(link)

            bsdf.inputs["Roughness"].default_value = 1.0
            bsdf.inputs["Metallic"].default_value = 0.0
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 0.0

    # The Bake UVs are the ones the atlas is addressed by, so they have to be
    # the set the atlas texture is sampled through. glTF exports both layers and
    # resolves the reference by name, so the atlas lands on TEXCOORD_1 while the
    # clean 0..1 UVs stay on TEXCOORD_0 — which is what keeps the painted screens
    # legible, since the canvas textures the runtime builds sample channel 0.
    for obj in meshes:
        if "Bake" in obj.data.uv_layers:
            obj.data.uv_layers.active = obj.data.uv_layers["Bake"]
            obj.data.uv_layers["Bake"].active_render = True


def check_unlit_materials(meshes: list[bpy.types.Object]) -> None:
    """
    Refuses to export if a material is shared between a lightmapped mesh and an
    excluded one.

    The failure this catches is silent and total. `rewire_to_baked` points a
    material's base colour at the atlas through the Bake UVs; a mesh with no Bake
    layer sharing that material would be exported referencing a TEXCOORD_1 it
    does not have. The glTF is then malformed in a way most viewers paper over by
    falling back to channel 0 — so the mesh renders, sampling the atlas through
    its texture UVs, showing an arbitrary crop of another object's lighting.
    """
    baked_materials = {
        slot.material.name
        for obj in meshes
        for slot in obj.material_slots
        if slot.material is not None
    }
    clashes: dict[str, set[str]] = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or "Bake" in obj.data.uv_layers:
            continue
        for slot in obj.material_slots:
            if slot.material is not None and slot.material.name in baked_materials:
                clashes.setdefault(slot.material.name, set()).add(obj.name)

    if clashes:
        detail = "\n".join(f"  {mat} — also on {', '.join(sorted(objs))}" for mat, objs in sorted(clashes.items()))
        sys.exit(
            "These materials are on both a lightmapped mesh and an excluded one:\n"
            f"{detail}\n"
            "Give the excluded mesh its own material, or take it out of build_room.UNLIT."
        )


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
        if not os.path.exists(OUT_PNG):
            sys.exit(f"--reuse-atlas needs an existing atlas, and {OUT_PNG} is not there.")
        # Already the finished sRGB file, so it goes straight onto the materials
        # and there is nothing for `rewire_to_baked` to swap in afterwards.
        atlas = bpy.data.images.load(OUT_PNG, check_existing=False)
        atlas.name = "room_bake_srgb"
        atlas.colorspace_settings.name = "sRGB"
        baked_image = None
        meshes = prepare_materials(atlas)
        check_unlit_materials(meshes)
        print(f"[bake_room] reusing {OUT_PNG}; nothing was baked")
    else:
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
        # An 8-bit image clamps on write, so every value above 1.0 was destroyed
        # at the moment Cycles produced it — before anything could roll it off.
        # That is what made the lamp, the screens and both LED strips ship as
        # identical flat white shapes. The float buffer keeps the full range so
        # `tonemap.apply` has something left to compress.
        atlas = bpy.data.images.new("room_bake", args.size, args.size, float_buffer=True)
        meshes = prepare_materials(atlas)
        check_unlit_materials(meshes)

        print(f"[bake_room] baking {len(meshes)} objects at {args.size}px, {args.samples} samples")
        bake_in_batches(meshes, size=args.size)

        finish_atlas(atlas, OUT_PNG, exposure=args.exposure, saturation=args.saturation)
        print(f"[bake_room] wrote {OUT_PNG} ({os.path.getsize(OUT_PNG) / 1024 / 1024:.1f} MB)")

        # The materials point at the finished file, not at the float buffer they
        # were baked into. Two reasons: the bytes the glTF exporter packs are
        # then the exact bytes on disk rather than a second, independent
        # conversion, and the datablock arrives already labelled sRGB — which is
        # what the atlas now is, and what the browser will assume a base-colour
        # texture to be.
        baked_image = bpy.data.images.load(OUT_PNG, check_existing=False)
        baked_image.name = "room_bake_srgb"
        baked_image.colorspace_settings.name = "sRGB"

    rewire_to_baked(atlas, meshes, baked_image)

    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
        # JPEG, not PNG.
        #
        # The atlas is the whole download: the room *is* the site, so the GLB
        # blocks first paint. A lossless 4096 lightmap is 8.9 MB and takes the
        # GLB to 12.4 MB, which is not a portfolio's first impression. A
        # lightmap is also the ideal JPEG subject — broad smooth gradients, no
        # text, no hard edges except at island borders, which the 12 px bleed
        # margin already softens.
        #
        # Quality is high on purpose. Banding in a large soft gradient is the
        # one artefact that would show here, and it appears well before blocking
        # does.
        export_image_format="JPEG",
        export_jpeg_quality=92,
    )
    print(f"[bake_room] wrote {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024 / 1024:.1f} MB)")

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
    }
    with open(OUT_STAMP, "w", encoding="utf-8") as handle:
        json.dump(stamp, handle, indent=2)
        handle.write("\n")
    print(f"[bake_room] wrote {OUT_STAMP} (source {stamp['source'][:12]}…)")
    print("[bake_room] done — the runtime will now prefer the baked room")


if __name__ == "__main__":
    main()
