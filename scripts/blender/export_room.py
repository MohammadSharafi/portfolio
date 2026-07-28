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

import math
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
    "ix_cv_face": "Screens.tsx prints the CV onto this",
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
    ("ix_cv", "desk_top"),
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


# Loose things standing on a surface. None of these should share space with
# another: a screen inside its own bezel is fine and expected, two objects on a
# desktop occupying the same 9 cm is not.
LOOSE = (
    "ix_keyboard", "ix_mouse", "ix_mug", "ix_notebook", "ix_pencil",
    "ix_headphones", "ix_cv", "laptop_base", "lamp",
)

# How far two loose props may interpenetrate before it is a mistake. Contact is
# fine and a millimetre of bevel poking through is not worth a warning.
TOUCH_TOLERANCE = 0.004


def check_clearance() -> list[str]:
    """
    Loose props standing inside one another.

    The headphones spent a long time 9 cm inside the notebook, resting on
    nothing and passing through the cover, and a document holder was once
    placed straight inside the desk lamp. Neither looks broken from the
    establishing shot — one solid ends where another begins and the eye reads
    it as contact — which is why they both survived being looked at.
    """
    boxes: dict[str, tuple[float, ...]] = {}
    for name in LOOSE:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        boxes[name] = (
            min(p.x for p in pts), max(p.x for p in pts),
            min(p.y for p in pts), max(p.y for p in pts),
            min(p.z for p in pts), max(p.z for p in pts),
        )

    complaints = []
    names = sorted(boxes)
    for index, first in enumerate(names):
        for second in names[index + 1:]:
            a, b = boxes[first], boxes[second]
            overlap = [
                min(a[1], b[1]) - max(a[0], b[0]),
                min(a[3], b[3]) - max(a[2], b[2]),
                min(a[5], b[5]) - max(a[4], b[4]),
            ]
            if all(o > TOUCH_TOLERANCE for o in overlap):
                complaints.append(
                    f"{first} and {second} overlap by "
                    f"{overlap[0] * 100:.1f} x {overlap[1] * 100:.1f} x {overlap[2] * 100:.1f} cm"
                )
    return complaints


# How far a camera stop's target may fall outside the object it is meant to be
# looking at. Aiming a little in front of a screen is deliberate; aiming at the
# far side of the room is not.
AIM_TOLERANCE = 0.25

# Objects whose stop is deliberately nowhere near the mesh, with the reason.
# Listed rather than handled by loosening the tolerance for everyone, because a
# tolerance wide enough to cover this one would be wide enough to hide the next
# genuine mistake.
AIM_EXEMPT = {
    "window": "ix_window is the Toronto skyline 26 m outside; the stop frames the opening",
}


def check_stops() -> list[str]:
    """
    Camera stops pointing at nothing.

    This is the failure that hides best. A stop is two vectors in a data file,
    written in glTF space while the model is authored in Blender space, and
    nothing connects them to the object they name — so when the desk was
    rearranged, six of the fifteen stops kept the coordinates of where their
    object used to be. Clicking the lamp flew the camera 2.4 m to the left of
    it and stopped, framing bare desk, and the room looked like it had simply
    decided not to respond.

    Blender `(x, y, z)` exports as glTF `(x, z, -y)`, so a target read out of
    the registry comes back here as `(x, -z, y)`.
    """
    source = open(REGISTRY, encoding="utf-8").read()
    stops = re.findall(
        r"id: '([a-z0-9-]+)',.*?target: \[\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]",
        source,
        re.S,
    )

    complaints = []
    for object_id, gx, gy, gz in stops:
        if object_id in AIM_EXEMPT:
            continue
        prefix = "ix_" + object_id.replace("-", "_")
        points = []
        for obj in bpy.context.scene.objects:
            if obj.type != "MESH":
                continue
            if obj.name == prefix or obj.name.startswith(f"{prefix}_"):
                points += [obj.matrix_world @ v.co for v in obj.data.vertices]
        if not points:
            complaints.append(f"{object_id} has a camera stop but no mesh named {prefix}")
            continue

        target = (float(gx), -float(gz), float(gy))
        away = [
            max(min(p[axis] for p in points) - target[axis],
                target[axis] - max(p[axis] for p in points), 0.0)
            for axis in range(3)
        ]
        miss = math.sqrt(sum(a * a for a in away))
        if miss > AIM_TOLERANCE:
            complaints.append(
                f"{object_id}'s camera stop aims {miss * 100:.0f} cm off the object — "
                f"it looks at {target}, and {prefix} is nowhere near there"
            )
    return complaints


# Lights that stand for a visible fixture, and how far from it they may sit.
# A light representing a lamp has to be inside the lamp.
LIGHT_FIXTURES = (("lamp_light", "ix_lamp", 0.20),)


def check_lights() -> list[str]:
    """
    Lights that have drifted away from the object they are supposed to be coming
    from.

    This is the third instance of one bug. The desk lamp was moved to the
    back-right corner of the desk and three things were left behind at its old
    position: its power cable, its camera stop, and its light — so the room's
    warmest pool fell on a bare patch of desk two and a half metres from the
    lamp casting it. None of them looked broken. A lit room with the light in
    the wrong place just looks like a slightly odd lighting choice.
    """
    complaints = []
    for light_name, fixture_name, tolerance in LIGHT_FIXTURES:
        light = bpy.data.objects.get(light_name)
        fixture = bpy.data.objects.get(fixture_name)
        if light is None or fixture is None:
            continue
        points = [fixture.matrix_world @ v.co for v in fixture.data.vertices]
        centre = [sum(p[axis] for p in points) / len(points) for axis in range(3)]
        away = math.sqrt(sum((light.location[axis] - centre[axis]) ** 2 for axis in range(3)))
        if away > tolerance:
            complaints.append(
                f"{light_name} is {away * 100:.0f} cm from {fixture_name} — "
                f"the light is not coming from the thing that appears to cast it"
            )
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
