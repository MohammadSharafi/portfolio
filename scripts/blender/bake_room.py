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
    # Exposure is a knob rather than a constant because the only way to judge a
    # bake is to look at one, and that cannot happen on the machine that writes
    # this script — it has no Cycles. One flag beats editing light energies and
    # re-running blind.
    scene.view_settings.exposure = exposure
    scene.cycles.use_denoising = True
    scene.cycles.bake_type = "COMBINED"

    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
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


def prepare_materials(atlas: bpy.types.Image) -> list[bpy.types.Object]:
    """
    Gives every material an Image Texture node pointing at the shared atlas and
    makes it active, which is where Cycles writes.
    """
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]

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


def rewire_to_baked(atlas: bpy.types.Image, meshes: list[bpy.types.Object]) -> None:
    """
    Repoints every material at the atlas.

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

            uv = nodes.new("ShaderNodeUVMap")
            uv.uv_map = "Bake"
            uv.location = (-1100, 400)
            links.new(uv.outputs["UV"], tex.inputs["Vector"])
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

            bsdf.inputs["Roughness"].default_value = 1.0
            bsdf.inputs["Metallic"].default_value = 0.0
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = 0.0

    # The Bake UVs are the ones the atlas is addressed by, so they have to be
    # the set glTF exports as UV0.
    for obj in meshes:
        if "Bake" in obj.data.uv_layers:
            obj.data.uv_layers.active = obj.data.uv_layers["Bake"]
            obj.data.uv_layers["Bake"].active_render = True


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

    # Procedural wood grain, fabric weave and brushed metal, wired in only for
    # the bake. The plain glTF export cannot carry a node graph — it writes
    # white where one is linked — so the room ships flat and is textured here,
    # where everything resolves into the atlas anyway. Materials opt in with a
    # `grain` custom property, which is stored in the .blend and can be set on
    # anything modelled by hand.
    print(f"[bake_room] grain applied to {build_room.apply_grain()} materials")

    build_room.unwrap_all()

    if not ensure_cycles():
        sys.exit(
            "Cycles could not be selected as the render engine.\n"
            "Open Blender normally, enable Cycles under Preferences > Add-ons,\n"
            "save preferences, then run this again."
        )
    print("[bake_room] Cycles enabled")

    configure_cycles(args.samples, args.cpu, args.exposure)

    atlas = bpy.data.images.new("room_bake", args.size, args.size, float_buffer=False)
    meshes = prepare_materials(atlas)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    print(f"[bake_room] baking {len(meshes)} objects at {args.size}px, {args.samples} samples")
    bpy.ops.object.bake(type="COMBINED", use_clear=True)

    os.makedirs(OUT_DIR, exist_ok=True)
    atlas.filepath_raw = OUT_PNG
    atlas.file_format = "PNG"
    atlas.save()
    print(f"[bake_room] wrote {OUT_PNG}")

    rewire_to_baked(atlas, meshes)

    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
        export_image_format="AUTO",
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
