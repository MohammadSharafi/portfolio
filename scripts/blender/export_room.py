"""
Exports the hand-modelled room from `assets/room.blend` to `public/models/room.glb`.

    blender --background --python scripts/blender/export_room.py

The .blend is the source of truth for the room's geometry. `build_room.py`
generated the blockout it started from and is kept for that purpose, but it no
longer feeds the site — once a human has moved a vertex, regenerating from the
script would throw that away.

The reason this script exists rather than exporting from Blender's File menu is
the naming contract. The web app finds every interactive object by mesh name:
rename `ix_chair` to `Chair` while modelling and nothing errors, the export
succeeds, the site loads, and the chair silently stops turning. Nobody notices
until someone looks closely at a room they have already seen a hundred times.
So the export refuses to run against a scene missing a name the runtime needs.
"""

from __future__ import annotations

import os
import re
import sys

import bpy

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BLEND = os.path.join(ROOT, "assets", "room.blend")
OUT_GLB = os.path.join(ROOT, "public", "models", "room.glb")
REGISTRY = os.path.join(ROOT, "src", "room", "data", "objects.ts")


def clickable_names() -> list[str]:
    """
    The mesh names that make an object clickable, read from the registry.

    `RoomModel.toObjectId` takes a mesh name, strips the `ix_` prefix and any
    `_N` suffix glTF added when splitting a multi-material mesh, swaps
    underscores for dashes, and looks the result up in `objectIds`. So the name
    Blender needs is the id with its dashes turned into underscores.

    Parsed out of the TypeScript rather than copied here. A second copy of a
    list is a list that goes stale, and this file has already been bitten once
    by exactly that — the bake script kept its own copy of the builder list and
    spent a while baking a room with no furniture in half of it.
    """
    source = open(REGISTRY, encoding="utf-8").read()
    match = re.search(r"export const objectIds = \[(.*?)\] as const", source, re.S)
    if not match:
        sys.exit(f"could not find `objectIds` in {REGISTRY}; has the registry moved?")
    ids = re.findall(r"'([a-z0-9-]+)'", match.group(1))
    return [f"ix_{name.replace('-', '_')}" for name in ids]


# Names the runtime systems look up directly, beyond the clickable set. Each is
# listed with what breaks without it, because "the export failed" is only useful
# if it also says what the missing object was for.
SYSTEM_MESHES = {
    "ix_monitor_health_display": "Screens.tsx paints the clinical dashboard onto this",
    "ix_monitor_code_display": "Screens.tsx paints the editor onto this",
    "ix_laptop_display": "Screens.tsx paints the terminal onto this; Animations.tsx swings it",
    "ix_whiteboard_face": "Screens.tsx paints the architecture diagram onto this",
    "ix_sticky_notes": "Screens.tsx paints the notes onto this",
    "ix_laptop_lid_body": "Animations.tsx swings the lid on this",
    "ix_chair": "Animations.tsx turns the chair by this",
    "ix_lamp": "Animations.tsx drives the bulb's emission through this",
    "ix_mug": "Props.tsx gives this a rigid body",
    "ix_pencil": "Props.tsx gives this a rigid body",
    "ix_mouse": "Props.tsx gives this a rigid body",
}

# Book spines are numbered, one per project, and Screens.tsx paints a title onto
# each. The count has to match the number of titled books the shelf carries.
SPINE_COUNT = 6


def scene_mesh_names() -> set[str]:
    return {obj.name for obj in bpy.context.scene.objects if obj.type == "MESH"}


def validate(names: set[str]) -> list[str]:
    """
    Every name the runtime needs, checked against what the scene actually has.

    Matching is by prefix, the same way the runtime matches: an object built
    from several materials arrives in the browser split into `ix_chair`,
    `ix_chair_1` and so on, and a modeller who splits one by hand should not
    trip this.
    """
    def present(required: str) -> bool:
        return any(name == required or name.startswith(f"{required}_") for name in names)

    # Keyed by name so an object that several systems depend on is reported
    # once, listing everything it takes down with it, rather than once per
    # system as if they were separate problems.
    missing: dict[str, list[str]] = {}

    def note(required: str, why: str) -> None:
        if not present(required):
            missing.setdefault(required, []).append(why)

    for required in clickable_names():
        note(required, "clicking it opens its panel")

    for required, why in SYSTEM_MESHES.items():
        note(required, why)

    for index in range(SPINE_COUNT):
        note(f"ix_book_spine_{index}", "Screens.tsx paints a project title onto this spine")

    return [f"{name} — {'; '.join(reasons)}" for name, reasons in missing.items()]


# What each prop is supposed to be resting on, as (prop prefix, surface object).
# Checked because it keeps happening: the laptop's body sat entirely inside the
# desk for weeks, its screen apparently standing on the desktop with nothing
# under it, and the keyboard and notebook were sunk too. A buried object is
# invisible rather than obviously wrong, which is exactly why it survives.
RESTS_ON = (
    ("laptop_base", "desk_top"),
    ("ix_keyboard", "desk_top"),
    ("ix_mouse", "desk_top"),
    ("ix_mug", "desk_top"),
    ("ix_notebook", "desk_top"),
    ("ix_headphones", "desk_top"),
    # Joined, so its footprint covers every loose thing on the desk at once —
    # which is what caught the papers sliding off the front.
    ("desk_clutter", "desk_top"),
)

# How far a prop may sink into what carries it before it is a mistake. A
# millimetre or two is deliberate — it stops a coplanar contact z-fighting.
SINK_TOLERANCE = 0.006

# And how far it may hang off the edge. Nothing should, but a millimetre of
# float error is not a bug.
EDGE_TOLERANCE = 0.004


def _top_of(name: str) -> float | None:
    obj = bpy.data.objects.get(name)
    if obj is None:
        return None
    return max((obj.matrix_world @ v.co).z for v in obj.data.vertices)


def _bottom_of(name: str) -> float | None:
    obj = bpy.data.objects.get(name)
    if obj is None:
        return None
    return min((obj.matrix_world @ v.co).z for v in obj.data.vertices)


def _footprint(name: str) -> tuple[float, float, float, float] | None:
    obj = bpy.data.objects.get(name)
    if obj is None:
        return None
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return (min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts))


def check_resting() -> list[str]:
    """
    Props that have sunk into the surface they sit on, or slid off its edge.

    Both have happened, and neither announces itself: a buried object is
    invisible, and an overhanging one just looks slightly wrong from the one
    angle that shows the edge. The keyboard spent weeks with a third of itself
    hanging in mid-air.
    """
    complaints: list[str] = []
    for prop, surface in RESTS_ON:
        top = _top_of(surface)
        bottom = _bottom_of(prop)
        if top is not None and bottom is not None:
            sunk = top - bottom
            if sunk > SINK_TOLERANCE:
                complaints.append(f"{prop} is {sunk * 100:.1f} cm inside {surface}")

        under = _footprint(surface)
        over = _footprint(prop)
        if under is None or over is None:
            continue
        overhang = max(
            under[0] - over[0],  # off the -X edge
            over[1] - under[1],  # off the +X edge
            under[2] - over[2],  # off the -Y edge
            over[3] - under[3],  # off the +Y edge
        )
        if overhang > EDGE_TOLERANCE:
            complaints.append(f"{prop} hangs {overhang * 100:.1f} cm off the edge of {surface}")
    return complaints


def ensure_uvs() -> int:
    """
    Give every mesh a UV layer if it has none.

    Hand-modelled geometry often arrives unwrapped, and a mesh with no UVs
    exports fine and then renders untextured. Cheap to fix here, expensive to
    notice later.
    """
    fixed = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
            fixed += 1
    return fixed


def main() -> None:
    if not os.path.exists(BLEND):
        sys.exit(
            f"{BLEND} does not exist.\n"
            "Generate the blockout to start from:\n"
            "    python3 scripts/blender/build_room.py --blend"
        )

    bpy.ops.wm.open_mainfile(filepath=BLEND)

    names = scene_mesh_names()
    problems = validate(names)
    if problems:
        print(f"\n[export_room] {len(problems)} object(s) the web app needs are missing:\n", file=sys.stderr)
        for problem in problems:
            print(f"  · {problem}", file=sys.stderr)
        sys.exit(
            "\nRename them back in Blender, or update the runtime to match.\n"
            "Nothing was exported — the site is still running the last good room."
        )

    added = ensure_uvs()
    if added:
        print(f"[export_room] added a UV layer to {added} mesh(es) that had none")

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
    )

    # Counted off the evaluated mesh, not the raw one. The export applies
    # modifiers, and every object here carries a bevel — reading the triangle
    # count off `obj.data` reports less than half of what actually ships, which
    # is worse than not reporting it at all.
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph).to_mesh()
        evaluated.calc_loop_triangles()
        tris += len(evaluated.loop_triangles)
        obj.evaluated_get(depsgraph).to_mesh_clear()

    print(f"[export_room] {len(meshes)} objects, {tris} triangles, {len(bpy.data.materials)} materials")
    print(f"[export_room] wrote {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
