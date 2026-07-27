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

The runtime prefers room-baked.glb when it is present and falls back to the
real-time lit room.glb when it is not, so running this is an upgrade rather than
a requirement.
"""

from __future__ import annotations

import argparse
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "models")
OUT_GLB = os.path.join(OUT_DIR, "room-baked.glb")
OUT_PNG = os.path.join(OUT_DIR, "room-bake.png")

sys.path.insert(0, HERE)


def parse_args() -> argparse.Namespace:
    # Blender passes its own argv; everything after a bare `--` is ours.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="bake_room")
    parser.add_argument("--size", type=int, default=4096, help="atlas resolution")
    parser.add_argument("--samples", type=int, default=256, help="Cycles samples")
    parser.add_argument("--cpu", action="store_true", help="force CPU rendering")
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


def configure_cycles(samples: int, force_cpu: bool) -> None:
    scene = bpy.context.scene
    scene.cycles.samples = samples
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

    # The hand-modelled room, not a fresh run of the blockout script. Building
    # from `build_room` here would bake a room nobody has touched since it was
    # generated and quietly discard every hour of modelling — the export path
    # reads the .blend, and so must this, or the two ship different rooms.
    blend = os.path.join(ROOT, "assets", "room.blend")
    if not os.path.exists(blend):
        sys.exit(
            f"{blend} does not exist.\n"
            "Generate the blockout to start from:\n"
            "    blender --background --python scripts/blender/build_room.py -- --blend"
        )
    bpy.ops.wm.open_mainfile(filepath=blend)
    print(f"[bake_room] loaded {blend}")

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

    configure_cycles(args.samples, args.cpu)

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
    print("[bake_room] done — the runtime will now prefer the baked room")


if __name__ == "__main__":
    main()
