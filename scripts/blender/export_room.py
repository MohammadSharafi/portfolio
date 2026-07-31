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

import hashlib
import json
import math
import os
import re
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# Blender does not put the running script's directory on `sys.path`, so a
# sibling module is not importable without this. `build_room` and `bake_room`
# both do the same for the same reason.
if HERE not in sys.path:
    sys.path.insert(0, HERE)

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
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
    "ix_lamp": "the desk lamp's clickable fixture; its bulb is `lamp_bulb`",
    "ix_mug": "Props.tsx gives this a rigid body",
    "ix_pencil": "Props.tsx gives this a rigid body",
    "ix_mouse": "Props.tsx gives this a rigid body",
}

# Book spines are numbered, one per project, and Screens.tsx paints a title onto
# each. The count has to match the number of titled books the shelf carries.
SPINE_COUNT = 6


def geometry_fingerprint() -> str:
    """
    A hash of everything a bake depends on: shape, lights and emission.

    The stamp used to record a hash of `room.glb` itself, and the runtime
    ignored the lightmap unless the served model matched it byte for byte. That
    is correct but far too strict, because the file also contains every texture:
    softening the wood grain, or changing a base colour, produced a different
    GLB and threw away an hour-long bake that was still perfectly valid.

    What the bake depends on is where the surfaces are. The UV1 atlas it is
    indexed by is generated from the geometry at bake time, so identical
    geometry gives an identical atlas, and irradiance landing on a surface does
    not care what colour that surface is going to be painted.

    The one thing this deliberately does not catch is colour bleed. A wall
    repainted from cream to red changes the colour of the light bouncing off
    it, and that *is* in the lightmap. It is a second-order effect and worth
    trading for the ability to iterate on materials at all — a re-bake will pick
    it up whenever one next happens.

    Geometry is not quite the whole story, so this also covers the lights and
    every emissive material. Those are inputs to the bake in exactly the way a
    base colour is not: making a lamp shade glow adds a light source to the
    room, and the irradiance on every surface near it changes. Leaving them out
    would have let a genuinely stale bake pass as current, which is a worse
    failure than the over-strict rule this replaces — a stale lightmap looks
    plausible and is wrong.

    Positions are world-space and rounded to 0.01 mm so that a float that
    reassociated differently between two runs cannot invalidate a bake.
    """
    digest = hashlib.sha256()
    for obj in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if obj.type == "MESH":
            digest.update(obj.name.encode())
            matrix = obj.matrix_world
            for vertex in obj.data.vertices:
                x, y, z = matrix @ vertex.co
                digest.update(f"{x:.5f},{y:.5f},{z:.5f};".encode())
            for polygon in obj.data.polygons:
                digest.update(",".join(str(i) for i in polygon.vertices).encode())
        elif obj.type == "LIGHT":
            light = obj.data
            x, y, z = obj.matrix_world.translation
            size = getattr(light, "size", 0.0)
            digest.update(
                f"light:{obj.name}:{light.type}:{light.energy:.4f}:"
                f"{tuple(round(c, 5) for c in light.color)}:{size:.4f}:"
                f"{x:.5f},{y:.5f},{z:.5f};".encode()
            )

    # Emissive materials are light sources, whatever else they are.
    for mat in sorted(bpy.data.materials, key=lambda m: m.name):
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        strength = bsdf.inputs["Emission Strength"].default_value
        if strength <= 0:
            continue
        colour = tuple(round(c, 5) for c in bsdf.inputs["Emission Color"].default_value)
        digest.update(f"emit:{mat.name}:{strength:.4f}:{colour};".encode())

    return digest.hexdigest()


def write_geometry_stamp(path: str) -> str:
    """Records the fingerprint next to the model, for the build to inline."""
    fingerprint = geometry_fingerprint()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"geometry": fingerprint}, handle, indent=2)
        handle.write("\n")
    return fingerprint


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
    "window": "ix_window is the skyline 26 m outside; the stop frames the opening",
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
LIGHT_FIXTURES = (("lamp_light", "lamp_bulb", 0.20),)


def check_dark_fixtures() -> list[str]:
    """
    Lamps that cast no light.

    `check_lights` walks a curated list of light-and-fixture pairs, so it
    catches a light that has drifted away from its lamp and is completely blind
    to the opposite: a lamp nobody ever gave a light to. The floor lamp stood in
    the lounge for its whole existence as a lamp-shaped object with a bright
    shade and no source, 2 m from the nearest light in the room — which reads,
    at a glance, exactly like a lamp that is switched off, so nothing about it
    looked wrong.
    """
    lights = [o for o in bpy.context.scene.objects if o.type == "LIGHT"]
    complaints = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.data.vertices:
            continue
        if not any(word in obj.name for word in ("lamp", "bulb")):
            continue
        if obj.name.endswith("_light"):
            continue
        # Measured to the fixture's *bounds*, not its centroid.
        #
        # A floor lamp is a 1.6 m pole with a shade on top, so its centroid sits
        # halfway up the stem — 74 cm below the shade the bulb actually lives
        # in. Judging by centroid reports a correctly lit lamp as dark, which is
        # a check that trains you to ignore it.
        box = _world_box(obj)
        def _outside(light) -> float:
            at = light.matrix_world.translation
            return math.sqrt(
                sum(
                    max(box[axis * 2] - at[axis], 0.0, at[axis] - box[axis * 2 + 1]) ** 2
                    for axis in range(3)
                )
            )

        nearest = min(
            ((light, _outside(light)) for light in lights),
            key=lambda pair: pair[1],
            default=(None, 1e9),
        )
        if nearest[1] > 0.25:
            complaints.append(
                f"{obj.name} looks like a lamp but the nearest light is "
                f"{nearest[1] * 100:.0f} cm away — it casts nothing"
            )
    return complaints


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


# Things whose whole meaning is their distance from something else, as
# (object, reference, nearest, furthest, along which axis, what it is for).
# A chair belongs to a desk. Measured front-edge to front-edge: a chair tucked
# in overlaps the desk by a few centimetres, and one pushed back sits within
# arm's reach of it. Half a metre is a chair in the middle of the room.
PAIRED = (
    ("ix_chair", "desk_top", -0.10, 0.35, 1, "a chair belongs to its desk"),
)


def check_paired() -> list[str]:
    """
    Objects that only make sense next to another object, drifting apart.

    The desk rescale moved its front edge back 55 cm. Everything standing *on*
    the desk was rebuilt with it, but the chair — which is not on the desk and
    so was not in the list — stayed where it was, leaving it stranded half a
    metre out in open floor. A chair nobody could reach the keyboard from, in a
    room where the chair is the object people look at hardest.

    Nothing about that looks broken in a render. It reads as a chair someone
    pushed back, because that is a thing chairs do — which is why the fix is a
    check and not a better look at the picture.
    """
    complaints = []
    for name, reference, nearest, furthest, axis, why in PAIRED:
        obj = bpy.data.objects.get(name)
        ref = bpy.data.objects.get(reference)
        if obj is None or ref is None:
            continue
        # Front edges: the lesser extent along the axis for the object, and the
        # greater for the reference, since the room seats a person on the +y
        # side of a desk pushed against the -y wall.
        front = min((obj.matrix_world @ v.co)[axis] for v in obj.data.vertices)
        edge = max((ref.matrix_world @ v.co)[axis] for v in ref.data.vertices)
        gap = front - edge
        if not nearest <= gap <= furthest:
            complaints.append(
                f"{name} is {gap * 100:.0f} cm from {reference}, outside "
                f"{nearest * 100:.0f}–{furthest * 100:.0f} cm — {why}"
            )
    return complaints


# The solids that make up the room's shell. Anything mounted on one has to be
# in front of it, not inside it.
# Not the floor: a rug lying on it is inside its bounding box and entirely
# correct, and so is every floorboard.
SHELL = ("wall_back", "wall_left", "door")

# How much of an object may be inside the shell before it is a mistake. A few
# millimetres is how a fitting is fixed to a wall.
BURIED_TOLERANCE = 0.012


# The room's fixed furniture, by the name each is joined under.
#
# Deliberately a short curated list rather than every mesh in the scene. Most of
# the room legitimately interpenetrates — books sit inside a bookcase, a display
# sits inside a monitor shell, an arm passes through the housing it bolts to —
# and a check that reported all of it would produce sixty lines nobody reads.
# These are the pieces that stand on the floor or hang on a wall and have no
# business occupying the same space as each other.
FURNITURE = (
    "bookshelf", "desk_top", "drawers", "ix_server_rack", "radiator",
    "window_frame", "ix_whiteboard", "wall_art", "guitar", "sofa_base",
    "coffee_table", "side_table", "floor_lamp", "lamp", "door", "ix_chair",
    "light_switch", "socket_0", "socket_1", "ix_certificates",
)

# Pairs that are meant to share space. A chair pushed in at a desk puts its
# armrests under the overhang, which is what "pushed in" means — the plan even
# asks for it. Listing the few honest cases keeps the check useful for the many
# dishonest ones.
FURNITURE_ALLOWED = frozenset({
    frozenset({"ix_chair", "desk_top"}),
})

# How far two pieces of furniture may overlap before it is a mistake. Generous:
# a chair tucked under a desk and a lamp overhanging a sill are both correct and
# both overlap a little once reduced to boxes.
FURNITURE_TOLERANCE = 0.02


def _world_box(obj) -> tuple[float, ...]:
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return (
        min(p.x for p in pts), max(p.x for p in pts),
        min(p.y for p in pts), max(p.y for p in pts),
        min(p.z for p in pts), max(p.z for p in pts),
    )


# What orientation each painted quad's canvas needs, as `finish` in
# src/room/systems/screenContent.ts names them. Kept here because it is a fact
# about the *model* — which way a quad was stood up — and the runtime is only
# compensating for it.
PAINTED_ORIENTATION = {
    "ix_monitor_health_display": "mirror-u",
    "ix_monitor_code_display": "mirror-u",
    "ix_laptop_display": "mirror-u",
    "ix_cv_face": "mirror-u",
    "ix_whiteboard_face": "flip-v",
    "ix_sticky_notes": "flip-v",
    "ix_book_spine_": "flip-v",
}


def check_uv_stretch(layer: int = 0, starved: float = 0.25, share: float = 0.04) -> list[str]:
    """
    Meshes with a real amount of surface starved of texels.

    A face whose UV island is squashed gets fewer texels than its area
    deserves, so whatever is sampled through it is smeared. That mattered
    little when UV0 carried nothing but a repeating half-metre tile of wood
    grain — a smear in noise still looks like noise. It matters on UV1, where
    the lightmap and the aging masks live, because those are *positional*: a
    starved island puts one texel of dust across a hand's width of desk, and
    the edge of a wear mark lands somewhere the edge is not.

    Measured by area, not by ratio, which is the whole difference between this
    being useful and being ignored. The first version reported the spread
    between the least and most dense face and fired on nine objects at once
    with numbers like 2245x — all of them cylinder poles and cone tips, a few
    square millimetres of degenerate triangle that no texture will ever be read
    from. Weighting by surface area drops those to nothing and leaves the
    question worth asking: how much of this object is genuinely under-sampled?

    `share` is deliberately different for the two layers. UV1 is held tight
    because the masks on it are positional. UV0 is run loose, because what it
    carries is a repeating noise tile and a fifth of a cable at half density is
    a fifth of a cable whose grain is slightly finer — nobody can see it, and
    the objects it fires on (the blind's slats, the guitar's body, the
    radiator's fins, the cables) are curved or thin enough that no planar
    unwrap avoids it. Lowering the projection angle to split them into flatter
    islands was tried and made it worse: more islands meant more of the mesh
    near a seam. That is a real constraint of unwrapping curved geometry, not
    a bug waiting to be fixed.
    """
    complaints = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or len(obj.data.uv_layers) <= layer:
            continue
        mesh = obj.data
        uv = mesh.uv_layers[layer]

        faces = []
        for polygon in mesh.polygons:
            loops = list(polygon.loop_indices)
            origin = uv.data[loops[0]].uv
            area = 0.0
            for index in range(1, len(loops) - 1):
                a = uv.data[loops[index]].uv - origin
                b = uv.data[loops[index + 1]].uv - origin
                area += abs(a.x * b.y - a.y * b.x) * 0.5
            if area > 1e-12 and polygon.area > 1e-9:
                faces.append((area / polygon.area, polygon.area))

        total = sum(weight for _, weight in faces)
        if len(faces) < 8 or total <= 0:
            continue

        # Area-weighted median density: the density half the surface is below.
        faces.sort()
        running = 0.0
        median = faces[-1][0]
        for density, weight in faces:
            running += weight
            if running >= total * 0.5:
                median = density
                break

        smeared = sum(weight for density, weight in faces if density < median * starved)
        if smeared / total > share:
            complaints.append(
                f"{obj.name} UV{layer} has {100 * smeared / total:.0f}% of its surface "
                f"under {starved:.0%} of its own texel density"
            )
    return complaints


def check_metalness() -> list[str]:
    """
    Materials sitting between conductor and dielectric.

    Metalness selects a physical model, it does not blend two looks: a metal has
    no diffuse colour and tints its own reflection, a dielectric has diffuse
    colour and reflects white at about 4%, and nothing is 30% of the way
    between. An intermediate value only means something inside a texture, where
    it marks where paint stops and bare metal begins.

    The room had thirteen of these, and they are hard to spot by eye because
    the result is not obviously broken — it is a plastic bin that looks dingy,
    or a monitor shell that will not take a colour. See the note above
    `build_room.default_grain`.
    """
    complaints = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None or bsdf.inputs["Metallic"].is_linked:
            continue
        value = bsdf.inputs["Metallic"].default_value
        if 0.05 < value < 0.95:
            complaints.append(f"{mat.name} is {value:.2f} metallic, which is neither a metal nor a dielectric")
    return complaints


def check_uniform_materials() -> list[str]:
    """
    Materials shipping a perfectly constant roughness.

    Nothing real has one. A constant roughness returns a highlight of exactly
    the same size and sharpness across a whole surface, and the eye reads that
    as plastic — it is the reason untextured 3D looks untextured even when
    every colour is correct.

    `build_room.default_grain` means a material now has to opt *out* of surface
    detail rather than remember to opt in, so this should stay quiet. It exists
    for the case that rule cannot cover: a material built by hand in the .blend,
    or one whose grain was wired and then trampled. Those are exactly the ones
    nobody would think to look for.

    Warned about, not fatal. A flat material is a missed opportunity, not a
    broken room, and a check that blocks the export over one would get deleted.
    """
    import build_room

    allowed = build_room.FLAT_BY_DESIGN
    complaints = []
    for mat in bpy.data.materials:
        if mat.name in allowed or not mat.use_nodes:
            continue
        # Names collide across the room; `desk_top.001` is the same surface.
        if mat.name.split(".")[0] in allowed:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        # An emissive panel's appearance is its emission, not its finish.
        if bsdf.inputs["Emission Strength"].default_value > 0:
            continue
        if not bsdf.inputs["Roughness"].is_linked:
            complaints.append(
                f"{mat.name} has a flat roughness of "
                f"{bsdf.inputs['Roughness'].default_value:.2f} and no surface detail"
            )
    return complaints


def check_painted_uvs() -> list[str]:
    """
    Which way each painted quad's UVs actually run, against what the runtime
    assumes.

    Every readable surface in the room is a quad the browser paints a canvas
    onto, and which way that canvas lands is decided entirely by the rotation
    that stood the quad up. There is no correction that is right for all of
    them, so `finish` applies a different one per surface — and nothing
    connected the two, so a quad could be rotated and the drawing on it would
    silently turn over.

    Both the whiteboard and the sticky notes shipped upside down that way, and
    the book spines shipped upside down for longer, because spine text is far
    too small to read from any camera the room has. Nobody was going to catch
    that by looking.

    The derivation, which is worth stating because two conventions collide in
    it: a viewer reading a quad looks along its inward normal with world up, so
    screen-right is `(-normal) x up` and U has to run that way. V is the
    opposite of what it looks like — Blender writes v, glTF stores 1 - v, and
    the CanvasTexture the runtime builds flips Y a third time, so a quad whose
    V runs up in Blender is sampled bottom-to-top by the time it is drawn.
    """
    room_centre = Vector((0.0, 0.4, 1.2))
    up = Vector((0.0, 0.0, 1.0))

    complaints = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        expected = next(
            (v for k, v in PAINTED_ORIENTATION.items() if obj.name.startswith(k)), None
        )
        if expected is None:
            continue

        mesh = obj.data
        layer = mesh.uv_layers.active
        if layer is None or not mesh.polygons:
            continue

        poly = mesh.polygons[0]
        loops = list(poly.loop_indices)
        world = [obj.matrix_world @ mesh.vertices[mesh.loops[i].vertex_index].co for i in loops]
        uvs = [layer.data[i].uv for i in loops]

        origin, uv0 = world[0], uvs[0]
        du = dv = None
        for point, uv in zip(world[1:], uvs[1:]):
            delta = uv - uv0
            if abs(delta.x) > 0.5 and abs(delta.y) < 0.5 and du is None:
                du = (point - origin) / delta.x
            if abs(delta.y) > 0.5 and abs(delta.x) < 0.5 and dv is None:
                dv = (point - origin) / delta.y
        if du is None or dv is None:
            continue

        normal = (obj.matrix_world.to_3x3() @ poly.normal).normalized()
        if normal.dot(room_centre - origin) < 0:
            normal = -normal

        u_ok = du.normalized().dot((-normal).cross(up).normalized()) > 0
        v_ok = dv.normalized().dot(up) < 0

        actual = (
            "as-drawn" if u_ok and v_ok
            else "mirror-u" if v_ok
            else "flip-v" if u_ok
            else "rotate-180"
        )
        if actual != expected:
            complaints.append(
                f"{obj.name} needs '{actual}' in screenContent.ts, which says '{expected}'"
            )
    return complaints


def check_furniture() -> list[str]:
    """
    Fixed pieces standing inside one another.

    This is the check that would have caught the server rack, which stood with
    its top 15 cm inside the window frame and its whole body in front of the
    radiator. Neither reads as broken from the establishing shot — one solid
    ends where another begins and the eye takes it for contact — which is
    exactly why it survived being looked at for so long.
    """
    boxes = {}
    for name in FURNITURE:
        obj = bpy.data.objects.get(name)
        if obj is not None and obj.type == "MESH" and obj.data.vertices:
            boxes[name] = _world_box(obj)

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
            if frozenset({first, second}) in FURNITURE_ALLOWED:
                continue
            if all(o > FURNITURE_TOLERANCE for o in overlap):
                complaints.append(
                    f"{first} and {second} occupy the same space — "
                    f"{overlap[0] * 100:.0f} x {overlap[1] * 100:.0f} x {overlap[2] * 100:.0f} cm"
                )
    return complaints


def _is_transmissive(obj: bpy.types.Object) -> bool:
    """Whether any of an object's materials lets light through it."""
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None or not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        if bsdf.inputs["Alpha"].default_value < 0.99:
            return True
        if bsdf.inputs["Transmission Weight"].default_value > 0.01:
            return True
    return False


def check_swallowed() -> list[str]:
    """
    Small fittings hidden inside a piece of furniture.

    `check_buried` catches a fitting sunk into a wall, but not one sealed inside
    a bookcase — which is where the left-wall socket spent its whole life, at
    y = 0.92 behind a case running y -0.10 to 2.00. It was modelled, textured
    and baked, and had never been visible from any camera in the room.
    """
    boxes = {}
    for name in FURNITURE:
        obj = bpy.data.objects.get(name)
        if obj is not None and obj.type == "MESH" and obj.data.vertices:
            boxes[name] = _world_box(obj)

    complaints = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name in FURNITURE or obj.name in SHELL:
            continue
        if not obj.data.vertices:
            continue
        # Anything the runtime addresses is *meant* to be nested — a display
        # sits inside its monitor, a spine inside its shelf, a bulb inside its
        # lamp. So are parts that share a stem with what holds them, like a
        # drawer face and its carcass. Reporting those buries the one line that
        # matters under a dozen that do not.
        if obj.name.startswith("ix_"):
            continue
        # Transmissive things are visible through whatever contains them, and
        # containment is the whole test here. The water in the tumbler sits
        # inside the coffee table's bounding box — which the magazine stack
        # stretches upward past it — and is entirely visible, through the glass
        # it is deliberately inside. A box test cannot see that; it can be told.
        if _is_transmissive(obj):
            continue
        stem = obj.name.split("_")[0]
        box = _world_box(obj)
        for name, big in boxes.items():
            if stem and (stem in name or name.split("_")[0] in obj.name):
                continue
            # Something standing *on* a piece of furniture is inside its
            # bounding box and perfectly visible — an award on a bookcase's
            # capping board sits between the two raised sides, so the box test
            # calls it swallowed. Resting on the top surface is the one case
            # where containment means the opposite of hidden.
            if box[4] >= big[5] - 0.05:
                continue
            inside = all(
                box[axis * 2] > big[axis * 2] - BURIED_TOLERANCE
                and box[axis * 2 + 1] < big[axis * 2 + 1] + BURIED_TOLERANCE
                for axis in range(3)
            )
            if inside:
                complaints.append(f"{obj.name} is entirely inside {name} and can never be seen")
                break
    return complaints


# Where the site opens, in Blender coordinates.
#
# `HOME_STOP` in src/room/data/objects.ts is in three.js space, and the glTF
# exporter converts Blender (x, y, z) to glTF (x, z, -y). Reversing that puts
# the home camera here. Kept as a derived constant with the arithmetic shown,
# because a hand-copied camera position that silently drifts from the runtime's
# would make this check confidently wrong rather than merely absent.
HOME_CAMERA = (6.35, 6.55, 4.70)   # three.js (6.35, 4.70, -6.55)
HOME_TARGET = (-0.22, -0.85, 1.05)  # three.js (-0.22, 1.05, 0.85)


# Parts that are one fixture split across several meshes.
#
# A monitor is a shell plus a display quad, a whiteboard is a board plus its
# painted face, a laptop is a base plus a lid plus a screen. Each pair is one
# object to a visitor and two to the exporter, and without this the front half
# of a thing counts as something blocking its own back half — which reported
# every monitor and the whiteboard as invisible while they sat in plain sight.
_FIXTURE_SUFFIXES = ("_face", "_display", "_lid_body", "_legends")
_FIXTURE_ALIASES = {"ix_keycap": "ix_keyboard"}


def _fixture(name: str) -> str:
    for suffix in _FIXTURE_SUFFIXES:
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    return _FIXTURE_ALIASES.get(name, name)


def _inside_room(point) -> bool:
    return -3.3 < point.x < 3.3 and -2.7 < point.y < 2.7 and -0.1 < point.z < 2.7


# Geometry that exists for the bake and is never exported.
#
# The ceiling is here so that Cycles has something for light to bounce off, and
# `drop_export_only` removes it immediately before the GLB is written. It is
# also directly between the home camera and everything in the room, since the
# camera looks down into an open box from above — so while this check runs
# (before the drop, because the bake fingerprint needs the full scene) the
# ceiling reported every interactive object as completely hidden.
#
# It is the same shape of mistake as counting a monitor's own screen as
# something blocking the monitor: a thing that is in the scene is not
# necessarily a thing anyone can see past.
_INVISIBLE_TO_CAMERA = re.compile(r"^ceiling(\.\d+)?$")


def _blocked(depsgraph, origin, point, obj) -> bool:
    """
    Is anything real between the camera and this point?

    Marching rather than a single cast, and that is the whole of it.
    `scene.ray_cast` returns the *first* hit and nothing else, and the first
    thing every ray out of the home camera meets is the bake-only ceiling —
    the camera looks down into an open box from above, so the ceiling is
    between it and the entire room. Skipping that hit and stopping there meant
    the check never saw what was behind it and reported every object as
    perfectly visible, including a laptop that was not.

    That is a worse failure than a wrong answer. A check that says nothing is
    wrong is indistinguishable from a room with nothing wrong in it, which is
    exactly why the laptop's placement was signed off twice.
    """
    direction = (point - origin).normalized()
    distance = (point - origin).length
    start = origin.copy()
    travelled = 0.0

    for _ in range(12):
        hit, location, _, _, hit_obj, _ = bpy.context.scene.ray_cast(
            depsgraph, start, direction
        )
        if not hit:
            return False
        reached = travelled + (location - start).length
        # Landing at the target, within a millimetre, means nothing was in the
        # way — everything closer has already been stepped past.
        if reached >= distance - 0.001:
            return False
        if _INVISIBLE_TO_CAMERA.match(hit_obj.name) or hit_obj is obj or (
            _fixture(hit_obj.name) == _fixture(obj.name)
        ):
            # Step just past this surface and carry on looking.
            travelled = reached + 0.001
            start = origin + direction * travelled
            continue
        return True

    return False


def check_occlusion(limit: float = 0.6) -> list[str]:
    """
    Interactive objects hidden behind something from the camera the site opens on.

    This is a different failure from intersection and nothing else here looks
    for it. `check_furniture` and `check_swallowed` both ask whether two objects
    occupy the same space; two objects can be perfectly clear of each other in
    the room and completely on top of each other in the frame, and only the
    frame is ever seen.

    It has cost time twice. The laptop was moved and turned once already on the
    reasoning that it "does not collide with the chair" — which was true, and
    irrelevant: the chair is nearer the camera with a back taller than the
    laptop's lid, so it covered it anyway. Nothing measured that, so the fix was
    judged by eye and the fault came back.

    Rays are cast from the home camera to points spread over each object's
    surface rather than to its centre, because an object half hidden behind a
    chair back still has a visible half and a centre-only test would call it
    either fine or invisible depending on which side of the edge the centre fell.
    """
    import mathutils

    depsgraph = bpy.context.evaluated_depsgraph_get()
    origin = mathutils.Vector(HOME_CAMERA)
    problems = []

    for obj in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if obj.type != "MESH" or not obj.name.startswith("ix_"):
            continue

        # Sample the object's own polygons, biased to the larger ones, so the
        # samples land where the object actually presents area to the camera.
        #
        # Restricted to the part of the object that is inside the room, because
        # `ix_window` is 110 m across: it is the frame *and* the city outside
        # it, and almost all of that city is legitimately behind a wall. Judging
        # the window by its whole extent reports it as invisible while the frame
        # sits in plain sight.
        polygons = [
            p for p in sorted(obj.data.polygons, key=lambda p: -p.area)
            if _inside_room(obj.matrix_world @ p.center)
        ][:60]
        if not polygons:
            continue

        blocked = 0
        tested = 0
        samples = []
        for polygon in polygons:
            centre = obj.matrix_world @ polygon.center
            # A polygon facing away cannot be seen even with nothing in front of
            # it, so counting it as blocked would report every closed object as
            # half hidden.
            normal = (obj.matrix_world.to_3x3() @ polygon.normal).normalized()
            if normal.dot((centre - origin).normalized()) > 0:
                continue

            # Several points per polygon, not just its centre.
            #
            # A laptop lid is four big quads. Sampling centres gave it three
            # test points, one of which faced away, so it fell under the
            # minimum and was skipped in silence — the check reported nothing
            # wrong with an object that was almost entirely behind a chair.
            # Coarse sampling does not produce a wrong answer, it produces no
            # answer, which is worse because it looks like a pass.
            samples.append(centre)
            for index in polygon.vertices:
                corner = obj.matrix_world @ obj.data.vertices[index].co
                samples.append(centre.lerp(corner, 0.6))

        for point in samples:
            tested += 1
            if _blocked(depsgraph, origin, point, obj):
                blocked += 1

        if tested < 4:
            continue
        share = blocked / tested
        if share > limit:
            problems.append(
                f"{obj.name} is {share:.0%} hidden from the home camera — "
                "it is clickable and cannot be seen"
            )

    return problems


def check_buried() -> list[str]:
    """
    Fittings swallowed by the surface they are mounted on.

    The room lies on the greater side of both walls, so standing proud of one
    means *adding* to the coordinate. Subtracting looks equally reasonable in
    the source and puts the object inside the plaster — which is how a radiator
    came to have all thirteen of its fins buried in the wall with 7 mm of back
    panel showing. It read as a blank white panel screwed to the wall, a thing
    that could plausibly exist, so nothing looked wrong.
    """
    shells = {}
    for name in SHELL:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        shells[name] = (
            min(p.x for p in pts), max(p.x for p in pts),
            min(p.y for p in pts), max(p.y for p in pts),
            min(p.z for p in pts), max(p.z for p in pts),
        )

    complaints = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name in SHELL or not obj.data.vertices:
            continue
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        box = (
            min(p.x for p in pts), max(p.x for p in pts),
            min(p.y for p in pts), max(p.y for p in pts),
            min(p.z for p in pts), max(p.z for p in pts),
        )
        for shell_name, shell in shells.items():
            inside = all(
                box[axis * 2] > shell[axis * 2] - BURIED_TOLERANCE
                and box[axis * 2 + 1] < shell[axis * 2 + 1] + BURIED_TOLERANCE
                for axis in range(3)
            )
            if inside:
                complaints.append(f"{obj.name} is entirely inside {shell_name}")
                break
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

    # The bake-only geometry goes before the GLB is written, and this script
    # has to do it as well as `build_room` does.
    #
    # `build_room --blend` drops the ceiling on its way to writing its own GLB,
    # but it saves `room.blend` *before* that — correctly, because the bake
    # needs the ceiling there to bounce light off. This script opens that blend
    # and, until now, exported everything in it. The room shipped with a 6.4 ×
    # 5.2 m lid over it, and since the establishing camera looks down into an
    # open box from above, the first thing a visitor saw was the underside of a
    # ceiling with the room hidden behind it.
    #
    # It went unnoticed for as long as it did because the previous `room.blend`
    # on disk predated the ceiling entirely, so this path had never once been
    # asked to remove anything. Rebuilding the blend from source is what
    # surfaced it.
    #
    # Deliberately after `validate` and before the export: the fingerprint that
    # ties a bake to a model is written by `build_room` from the full scene, so
    # nothing here may touch it — dropping geometry after stamping keeps the
    # lightmap valid, and dropping it before would invalidate every bake.
    # The stamp that ties a bake to a model, written from this scene.
    #
    # It has to happen here, and it has to happen *before* the drop. The stamp
    # used to be written only by a full `build_room` run — but `--blend` saves
    # the blend and exits without writing one, so anybody who rebuilt the blend
    # and then exported was shipping a model described by a fingerprint taken
    # from some earlier scene. The runtime compares the two and quietly refuses
    # the lightmap when they disagree, which looks exactly like a room that was
    # never baked: no error, no warning, just flat lighting and a wasted hour of
    # Cycles.
    #
    # Before the drop, because `bake_room` computes its own copy from the blend
    # with the bake-only geometry still in it. Taking the fingerprint after
    # removing the ceiling would produce a number the bake can never reproduce,
    # and every bake would look stale the moment it finished.
    stamp = write_geometry_stamp(os.path.join(ROOT, "public", "models", "room-geometry.json"))
    print(f"[export_room] geometry {stamp[:12]}…")

    # Imported here rather than at the top, mirroring how `build_room` imports
    # this module: the two need each other and a pair of module-level imports
    # would be a cycle.
    import build_room

    dropped = build_room.drop_export_only()
    if dropped:
        print(f"[export_room] {dropped} bake-only object(s) kept out of the GLB")

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
