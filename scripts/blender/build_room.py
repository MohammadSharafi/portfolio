"""
Builds "the digital office" in Blender and exports it as glTF.

Run headless, either against a real Blender install or the `bpy` PyPI module:

    blender --background --python scripts/blender/build_room.py
    python3 scripts/blender/build_room.py

The script is the source of truth for the room, not a .blend file. A binary
.blend cannot be reviewed in a diff, cannot be regenerated deterministically and
rots the moment someone nudges a vertex without telling anyone. Every object
here is placed by name and number, so re-blocking the room is a code change with
a history.

Objects that the web app makes interactive are named with an `ix_` prefix. The
runtime looks them up by that name, so renaming one here without renaming it in
`src/room/data/objects.ts` is a loud failure rather than a silent one.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "models")
OUT_GLB = os.path.normpath(os.path.join(OUT_DIR, "room.glb"))

# --------------------------------------------------------------------------
# Palette. Kept in one place so the room reads as one lit space; these are the
# same values the runtime falls back to if the model ever fails to load.
# --------------------------------------------------------------------------
PALETTE = {
    "wall": (0.086, 0.098, 0.129, 1),
    "wall_accent": (0.129, 0.106, 0.153, 1),
    "floor": (0.192, 0.137, 0.094, 1),
    "rug": (0.114, 0.125, 0.176, 1),
    "desk": (0.361, 0.243, 0.157, 1),
    "desk_frame": (0.086, 0.094, 0.118, 1),
    "metal": (0.451, 0.478, 0.541, 1),
    "dark_metal": (0.129, 0.145, 0.184, 1),
    "plastic": (0.063, 0.071, 0.094, 1),
    "keycap": (0.129, 0.145, 0.192, 1),
    "screen": (0.020, 0.031, 0.055, 1),
    "paper": (0.827, 0.855, 0.910, 1),
    "board": (0.882, 0.898, 0.929, 1),
    "leaf": (0.161, 0.373, 0.243, 1),
    "pot": (0.443, 0.286, 0.208, 1),
    "mug": (0.847, 0.353, 0.290, 1),
    "sticky": (0.988, 0.804, 0.294, 1),
    "sticky_alt": (0.541, 0.831, 0.925, 1),
    "book_a": (0.192, 0.376, 0.769, 1),
    "book_b": (0.541, 0.259, 0.788, 1),
    "book_c": (0.153, 0.475, 0.373, 1),
    "book_d": (0.867, 0.478, 0.243, 1),
    "warm": (1.0, 0.702, 0.353, 1),
    "cyan": (0.416, 0.749, 1.0, 1),
    "violet": (0.659, 0.482, 1.0, 1),
    "green": (0.353, 0.906, 0.612, 1),
    "red": (1.0, 0.372, 0.325, 1),
}

_materials: dict[str, bpy.types.Material] = {}


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def material(
    name: str,
    colour_key: str,
    *,
    roughness: float = 0.75,
    metallic: float = 0.0,
    emission: float = 0.0,
) -> bpy.types.Material:
    """A Principled BSDF material, cached by name so the GLB ships one copy."""
    if name in _materials:
        return _materials[name]

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    colour = PALETTE[colour_key]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = colour
        bsdf.inputs["Emission Strength"].default_value = emission
    _materials[name] = mat
    return mat


def shade(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def cube(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    rotation_z: float = 0.0,
    bevel: float = 0.006,
) -> bpy.types.Object:
    """
    A bevelled box. The chamfer is the whole reason a procedural room reads as
    designed rather than as primitives: without it every edge is a perfectly
    sharp line that catches no highlight and no ambient occlusion.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.scale = (size[0], size[1], size[2])
    obj.rotation_euler = (0, 0, rotation_z)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    smallest = min(size)
    if bevel > 0 and smallest > 0.02:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = min(bevel, smallest * 0.2)
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(50)

    return shade(obj, mat)


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    vertices: int = 24,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=vertices, location=location
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.rotation_euler = rotation
    # `use_auto_smooth` was removed in Blender 4.1; smooth-by-angle is now a
    # modifier, and for parts this small flat shading reads the same anyway.
    bpy.ops.object.shade_smooth()
    return shade(obj, mat)


def plane(
    name: str,
    size: tuple[float, float],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.scale = (size[0], size[1], 1)
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return shade(obj, mat)


def join(name: str, objects: list[bpy.types.Object]) -> bpy.types.Object:
    """
    Merges parts into one object.

    Draw calls, not triangles, are what a scene like this runs out of first — a
    bookshelf modelled as forty separate objects is forty draw calls for
    something the visitor reads as one thing.
    """
    objects = [o for o in objects if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = name
    # glTF splits a multi-material mesh into one node per material and names the
    # results after the *mesh data*, not the object. Without this the runtime
    # would be looking up `ix_keyboard` and finding `Cube037`.
    merged.data.name = name
    return merged


# --------------------------------------------------------------------------
# The room
# --------------------------------------------------------------------------


def _wall_with_opening(wall_mat: bpy.types.Material) -> bpy.types.Object:
    """
    The back wall, with the window aperture cut out by a boolean rather than
    faked with a lit panel. A painted-on view cannot be looked *through*: the
    parallax between the frame and the skyline as the camera moves is the whole
    reason the window reads as an opening and not as a poster.
    """
    wall = cube("wall_back", (11.0, 0.12, 5.4), (0, -2.6, 2.7), wall_mat, bevel=0)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(2.05, -2.6, 1.7))
    cutter = bpy.context.object
    cutter.name = "window_cutter"
    cutter.scale = (1.42, 0.4, 1.24)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    mod = wall.modifiers.new("Opening", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier="Opening")
    bpy.data.objects.remove(cutter, do_unlink=True)

    bpy.context.view_layer.objects.active = wall
    return wall


def build_toronto() -> list[bpy.types.Object]:
    """
    The view through the window: Toronto at night, seen from high up.

    Built at real distance rather than as a backdrop card so it parallaxes
    correctly. The whole thing sits inside the window's view cone, which is the
    only reason a few dozen boxes can stand in for a skyline — everything
    outside that cone is never on screen and is not modelled.
    """
    random_state = [20240726]

    def rand() -> float:
        random_state[0] = (random_state[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return random_state[0] / 0x7FFFFFFF

    tower_mat = material("sky_tower", "plastic", roughness=0.8, metallic=0.1)
    lit_mat = material("sky_lit", "warm", roughness=0.4, emission=2.2)
    cool_lit = material("sky_lit_cool", "cyan", roughness=0.4, emission=1.8)

    parts: list[bpy.types.Object] = []

    # The sky. A single emissive plane far enough back to sit behind everything.
    parts_sky = cube(
        "sky", (60, 0.2, 34), (2.05, -34, 8), material("sky", "screen", roughness=1.0, emission=0.35), bevel=0
    )

    # Lake Ontario, flat and dark, catching the city above it.
    lake = cube("lake", (34, 22, 0.2), (2.05, -26, -1.6), material("lake", "screen", roughness=0.65, metallic=0.0), bevel=0)

    # The CN Tower. Unmistakable, and the one object that fixes the city.
    cn: list[bpy.types.Object] = [
        cylinder("cn_shaft", 0.5, 15, (2.6, -14, 4.5), tower_mat, vertices=12),
        cylinder("cn_pod", 1.5, 1.5, (2.6, -14, 10.4), tower_mat, vertices=16),
        cylinder("cn_pod_lit", 1.55, 0.42, (2.6, -14, 10.6), lit_mat, vertices=16),
        cylinder("cn_upper", 0.85, 1.6, (2.6, -14, 12.6), tower_mat, vertices=14),
        cylinder("cn_mast", 0.16, 7.0, (2.6, -14, 16.6), tower_mat, vertices=8),
    ]
    beacon = cylinder("cn_beacon", 0.2, 0.2, (2.6, -14, 20.2), material("beacon", "red", roughness=0.3, emission=8.0), vertices=8)
    parts.append(join("cn_tower", cn + [beacon]))

    # The bank towers behind and beside it.
    blocks: list[bpy.types.Object] = []
    lights: list[bpy.types.Object] = []
    for i in range(26):
        x = -3 + rand() * 12
        y = -16 - rand() * 12
        w = 1.1 + rand() * 2.2
        d = 1.1 + rand() * 2.2
        h = 3 + rand() * rand() * 13
        blocks.append(cube(f"sky_block_{i}", (w, d, h), (x, y, h / 2 - 1.2), tower_mat, bevel=0))
        for band in range(1 + int(rand() * 3)):
            z = 0.8 + rand() * (h - 1.6)
            lights.append(
                cube(
                    f"sky_light_{i}_{band}",
                    (w + 0.04, d + 0.04, 0.1 + rand() * 0.14),
                    (x, y, z),
                    lit_mat if rand() > 0.35 else cool_lit,
                    bevel=0,
                )
            )
    parts.append(join("ix_window", [parts_sky, lake] + blocks + lights))
    return parts


def build_shell() -> list[bpy.types.Object]:
    """Floor, two walls and skirting. An open box, so the camera can see in."""
    wall = material("wall", "wall", roughness=0.95)
    accent = material("wall_accent", "wall_accent", roughness=0.95)
    floor_mat = material("floor", "floor", roughness=0.6)

    parts = [
        plane("floor", (6.4, 6.4), (0, 0, 0), floor_mat),
        # Floorboards, as shallow insets rather than a texture: they survive a
        # bake and cost a handful of triangles each.
        _wall_with_opening(wall),
        cube("wall_left", (0.12, 5.2, 5.4), (-3.2, 0, 2.7), accent, bevel=0),
        cube("skirting_back", (6.4, 0.05, 0.11), (0, -2.52, 0.055), material("skirt", "dark_metal")),
        cube("skirting_left", (0.05, 5.2, 0.11), (-3.12, 0, 0.055), material("skirt", "dark_metal")),
        plane("rug", (3.6, 2.8), (0.2, 0.6, 0.004), material("rug", "rug", roughness=1.0)),
    ]

    boards = []
    for i in range(16):
        boards.append(
            cube(
                f"board_{i}",
                (6.4, 0.012, 0.004),
                (0, -2.5 + i * 0.34, 0.004),
                material("board_line", "dark_metal", roughness=0.9),
                bevel=0,
            )
        )
    parts.append(join("floorboards", boards))
    return parts


def build_desk() -> list[bpy.types.Object]:
    top = material("desk", "desk", roughness=0.45)
    frame = material("desk_frame", "desk_frame", roughness=0.4, metallic=0.5)

    parts = [
        cube("desk_top", (3.5, 1.3, 0.07), (0, -1.85, 0.755), top),
        cube("desk_lip", (3.5, 0.05, 0.09), (0, -1.22, 0.75), top),
        cube("desk_leg_l", (0.08, 1.1, 0.72), (-1.66, -1.85, 0.36), frame),
        cube("desk_leg_r", (0.08, 1.1, 0.72), (1.66, -1.85, 0.36), frame),
        cube("desk_brace", (3.2, 0.06, 0.05), (0, -2.1, 0.18), frame),
        # Drawer unit, which also hides the join between desk and floor.
        cube("drawers", (0.62, 1.0, 0.66), (1.15, -1.9, 0.33), material("drawer", "plastic", roughness=0.5)),
    ]
    for i in range(3):
        parts.append(
            cube(
                f"drawer_face_{i}",
                (0.58, 0.03, 0.17),
                (1.15, -1.41, 0.16 + i * 0.21),
                material("drawer_face", "dark_metal", roughness=0.45),
            )
        )
        parts.append(
            cube(
                f"drawer_pull_{i}",
                (0.2, 0.02, 0.014),
                (1.15, -1.39, 0.16 + i * 0.21),
                material("pull", "metal", roughness=0.3, metallic=0.8),
            )
        )
    return parts


def build_monitors() -> list[bpy.types.Object]:
    """
    Two monitors on an arm. `ix_monitor_health` and `ix_monitor_code` are looked
    up by name at runtime, so they stay separate objects.
    """
    shell = material("monitor_shell", "plastic", roughness=0.4, metallic=0.25)
    screen_mat = material("screen", "screen", roughness=0.18)
    arm_mat = material("arm", "dark_metal", roughness=0.35, metallic=0.6)

    out: list[bpy.types.Object] = []

    for name, x, tilt in (("ix_monitor_health", -0.62, 0.16), ("ix_monitor_code", 0.66, -0.16)):
        body = cube(f"{name}_body", (1.1, 0.05, 0.64), (x, -2.16, 1.2), shell, rotation_z=tilt)
        # A single quad, not a thin box. A cube's UVs give every face its own
        # patch of the image, so a canvas texture applied to one tiles across
        # all six — which is exactly how the first attempt failed.
        screen = plane(f"{name}_display", (1.03, 0.58), (x, -2.128, 1.2), screen_mat,
                       rotation=(math.radians(-90), 0, tilt))
        out.append(join(name, [body]))
        out.append(screen)

    out += [
        cylinder("arm_post", 0.026, 0.62, (0.02, -2.34, 1.06), arm_mat, vertices=16),
        cube("arm_base", (0.26, 0.16, 0.03), (0.02, -2.34, 0.79), arm_mat),
        cylinder(
            "arm_cross",
            0.02,
            1.5,
            (0.02, -2.3, 1.3),
            arm_mat,
            vertices=12,
            rotation=(math.radians(90), 0, math.radians(90)),
        ),
    ]
    return out


def build_laptop() -> list[bpy.types.Object]:
    """
    Modelled open, with the lid as its own object pivoting on the hinge so the
    runtime can animate it shut. Origin sits on the hinge line, not the lid
    centre, or it swings through the desk.
    """
    body = material("laptop_body", "metal", roughness=0.3, metallic=0.75)
    screen_mat = material("laptop_screen", "screen", roughness=0.15)

    base = cube("laptop_base", (0.86, 0.6, 0.018), (0.06, -1.55, 0.774), body)
    deck = cube("laptop_deck", (0.72, 0.36, 0.004), (0.06, -1.62, 0.784), material("deck", "keycap"), bevel=0)

    lid = cube("ix_laptop_lid_body", (0.86, 0.02, 0.56), (0.06, -1.85, 1.05), body)
    lid_screen = plane(
        "ix_laptop_display", (0.8, 0.5), (0.06, -1.833, 1.05), screen_mat,
        rotation=(math.radians(-90), 0, 0)
    )
    # Bake the screen's facing rotation into its vertices before re-origining.
    # Left as an object rotation it also rotates the screen's offset from the
    # hinge, so the two halves swing on different arcs and the screen ends up
    # sitting proud of the panel instead of flush in it. Once baked, both parts
    # carry the same object rotation and stay coplanar through the whole swing.
    bpy.context.view_layer.objects.active = lid_screen
    bpy.ops.object.select_all(action="DESELECT")
    lid_screen.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    hinge = Vector((0.06, -1.85, 0.783))
    for obj in (lid, lid_screen):
        # Re-origin onto the hinge line so the lid rotates about it rather than
        # about its own centre, which would swing it through the desk.
        obj.data.transform(Matrix.Translation(obj.location - hinge))
        obj.location = hinge

    # Deliberately not joined. Joining the screen into the lid gives one mesh
    # with two materials, and glTF splits that into ix_laptop_lid_1 and _2 — so
    # the mesh named ix_laptop_display never reaches the export, and the runtime
    # paints a terminal onto something that does not exist. Both share the hinge
    # as their origin, so the animation turns them together without a parent.
    lid.rotation_euler = (math.radians(-14), 0, 0)
    lid_screen.rotation_euler = (math.radians(-14), 0, 0)

    return [lid, lid_screen, join("laptop_base", [base, deck])]


def build_keyboard_and_props() -> list[bpy.types.Object]:
    key_mat = material("keycap", "keycap", roughness=0.7)
    body_mat = material("kb_body", "plastic", roughness=0.5)

    keys = []
    for row in range(5):
        for col in range(15):
            keys.append(
                cube(
                    f"key_{row}_{col}",
                    (0.042, 0.042, 0.012),
                    (-0.46 + col * 0.066, -1.36 + row * 0.066, 0.8),
                    key_mat,
                    bevel=0.003,
                )
            )
    keyboard = join(
        "ix_keyboard",
        [cube("kb_body", (1.06, 0.38, 0.022), (0.04, -1.23, 0.789), body_mat)] + keys,
    )

    mouse = cylinder("ix_mouse", 0.045, 0.028, (0.78, -1.28, 0.797), body_mat, vertices=20)
    mouse.scale = (0.85, 1.5, 1.0)

    mug_mat = material("mug", "mug", roughness=0.35)
    mug_body = cylinder("mug_body", 0.055, 0.11, (-0.98, -1.34, 0.845), mug_mat)
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.038, minor_radius=0.009, location=(-0.905, -1.34, 0.85)
    )
    handle = bpy.context.object
    handle.name = "mug_handle"
    handle.rotation_euler = (0, math.radians(90), 0)
    shade(handle, mug_mat)
    mug = join("ix_mug", [mug_body, handle])

    pencil = cylinder(
        "ix_pencil",
        0.007,
        0.19,
        (0.62, -1.52, 0.796),
        material("pencil", "sticky", roughness=0.6),
        vertices=6,
        rotation=(0, math.radians(90), math.radians(18)),
    )

    notebook = cube(
        "ix_notebook",
        (0.34, 0.46, 0.03),
        (-1.05, -1.62, 0.785),
        material("notebook", "book_a", roughness=0.6),
        rotation_z=math.radians(-9),
    )

    headphones = cylinder(
        "ix_headphones",
        0.1,
        0.03,
        (-1.42, -1.72, 0.805),
        material("headphones", "plastic", roughness=0.45),
        vertices=20,
    )

    return [keyboard, mouse, mug, pencil, notebook, headphones]


def build_lamp() -> list[bpy.types.Object]:
    metal = material("lamp_metal", "metal", roughness=0.3, metallic=0.7)
    bulb_mat = material("bulb", "warm", roughness=0.4, emission=6.0)

    parts = [
        cylinder("lamp_base", 0.1, 0.02, (-1.32, -2.06, 0.8), metal),
        cylinder("lamp_post", 0.012, 0.48, (-1.32, -2.06, 1.03), metal, vertices=12),
        cylinder(
            "lamp_arm",
            0.011,
            0.34,
            (-1.18, -2.02, 1.25),
            metal,
            vertices=12,
            rotation=(0, math.radians(64), 0),
        ),
    ]
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.1, radius2=0.03, depth=0.15, location=(-1.02, -2.0, 1.2)
    )
    shade_obj = bpy.context.object
    shade_obj.name = "lamp_shade"
    shade_obj.rotation_euler = (0, math.radians(28), 0)
    shade(shade_obj, metal)
    parts.append(shade_obj)

    bulb = cylinder("ix_lamp", 0.032, 0.032, (-1.02, -2.0, 1.15), bulb_mat, vertices=12)
    return [join("lamp", parts), bulb]


def build_shelf_and_books() -> list[bpy.types.Object]:
    """The bookshelf on the left wall. Each book is a project."""
    wood = material("shelf_wood", "desk", roughness=0.6)
    parts = [
        cube("shelf_side_l", (0.05, 0.3, 1.9), (-3.05, 0.05, 0.95), wood),
        cube("shelf_side_r", (0.05, 0.3, 1.9), (-3.05, 1.85, 0.95), wood),
    ]
    for i in range(4):
        parts.append(cube(f"shelf_{i}", (0.28, 1.85, 0.04), (-3.05, 0.95, 0.3 + i * 0.5), wood))
    shelf = join("bookshelf", parts)

    books = []
    spines = []
    colours = ["book_a", "book_b", "book_c", "book_d"]

    # Level 2 sits at eye height, so that shelf carries the project books: one
    # per project, each with its own spine quad the runtime paints the title
    # onto. A quad per book rather than one texture stretched across the row —
    # the books are separate solids with separate UVs, so a shared image would
    # tile across every one of them instead of spanning them.
    TITLED_LEVEL = 2
    TITLED_COUNT = 6
    TITLED_WIDTH = 0.075

    for level in range(4):
        if level == TITLED_LEVEL:
            y = 0.2
            for index in range(TITLED_COUNT):
                h = 0.27 + (index % 3) * 0.014
                z = 0.32 + level * 0.5 + h / 2
                colour = colours[index % 4]
                books.append(
                    cube(
                        f"book_titled_{index}",
                        (0.2, TITLED_WIDTH, h),
                        (-3.05, y + TITLED_WIDTH / 2, z),
                        material(f"book_{colour}", colour, roughness=0.8),
                    )
                )
                # Proud of the spine face by 2mm so it never z-fights the book.
                spines.append(
                    plane(
                        f"ix_book_spine_{index}",
                        (TITLED_WIDTH * 0.86, h * 0.9),
                        (-2.947, y + TITLED_WIDTH / 2, z),
                        material(f"spine_{index}", colour, roughness=0.75),
                        rotation=(math.radians(90), 0, math.radians(90)),
                    )
                )
                y += TITLED_WIDTH + 0.008
            continue

        y = 0.18
        while y < 1.62:
            h = 0.24 + (hash((level, round(y, 2))) % 5) * 0.012
            w = 0.036 + (hash((level, round(y, 3))) % 4) * 0.008
            colour = colours[(level + int(y * 10)) % 4]
            books.append(
                cube(
                    f"book_{level}_{round(y, 3)}",
                    (0.2, w, h),
                    (-3.05, y, 0.32 + level * 0.5 + h / 2),
                    material(f"book_{colour}", colour, roughness=0.8),
                )
            )
            y += w + 0.006

    return [shelf, join("ix_bookshelf", books)] + spines


def build_whiteboard() -> list[bpy.types.Object]:
    board = cube("board_face", (0.04, 1.5, 1.05), (-3.12, -1.35, 1.72), material("board", "board", roughness=0.35))
    frame = cube("board_frame", (0.05, 1.6, 1.15), (-3.14, -1.35, 1.72), material("board_frame", "metal", roughness=0.4, metallic=0.6))

    # The writing surface is its own quad named `ix_whiteboard_face`, so the
    # runtime can paint a real drawn diagram onto it. The previous version was
    # six grey boxes standing in for one — an unlabelled rectangle is not a
    # diagram, it is a note saying a diagram goes here.
    face = plane(
        "ix_whiteboard_face",
        (1.42, 0.98),
        (-3.088, -1.35, 1.72),
        material("board_face_mat", "board", roughness=0.4),
        rotation=(math.radians(90), 0, math.radians(90)),
    )

    # Sticky notes, likewise one quad rather than six coloured chips.
    stickies = [
        plane(
            "ix_sticky_notes",
            (0.86, 0.42),
            (-3.086, -1.42, 1.12),
            material("sticky_face", "sticky", roughness=0.85),
            rotation=(math.radians(90), 0, math.radians(90)),
        )
    ]

    return [join("ix_whiteboard", [board, frame]), face, stickies[0]]


def build_server_rack() -> list[bpy.types.Object]:
    case = material("rack", "plastic", roughness=0.4, metallic=0.3)
    parts = [cube("rack_body", (0.5, 0.62, 1.2), (2.62, -2.1, 0.6), case)]
    leds = []
    for i in range(6):
        colour = "green" if i % 3 else "cyan"
        parts.append(cube(f"unit_{i}", (0.48, 0.02, 0.15), (2.62, -1.79, 0.18 + i * 0.18), material("unit", "dark_metal", roughness=0.5)))
        leds.append(
            cube(
                f"led_{i}",
                (0.05, 0.012, 0.018),
                (2.45, -1.78, 0.18 + i * 0.18),
                material(f"led_{colour}", colour, roughness=0.3, emission=5.0),
                bevel=0,
            )
        )
    return [join("ix_server_rack", parts + leds)]


def build_window() -> list[bpy.types.Object]:
    """
    The window onto Antalya. The view is a separate object so the runtime can
    cross-fade it between times of day.
    """
    frame_mat = material("win_frame", "paper", roughness=0.5)
    parts = [
        cube("win_top", (1.5, 0.1, 0.09), (2.05, -2.53, 2.3), frame_mat),
        cube("win_bottom", (1.5, 0.1, 0.09), (2.05, -2.53, 1.1), frame_mat),
        cube("win_left", (0.09, 0.1, 1.3), (1.35, -2.53, 1.7), frame_mat),
        cube("win_right", (0.09, 0.1, 1.3), (2.75, -2.53, 1.7), frame_mat),
        cube("win_mullion", (0.03, 0.06, 1.25), (2.05, -2.53, 1.7), frame_mat),
    ]
    # A sill, and glass with almost no roughness so it catches a reflection.
    parts.append(cube("win_sill", (1.6, 0.22, 0.06), (2.05, -2.46, 1.08), frame_mat))
    glass = cube(
        "win_glass",
        (1.34, 0.012, 1.2),
        (2.05, -2.58, 1.7),
        material("glass", "cyan", roughness=0.05, metallic=0.1),
        bevel=0,
    )
    glass.data.materials[0].blend_method = "BLEND" if hasattr(glass.data.materials[0], "blend_method") else None
    glass.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.12
    return [join("window_frame", parts + [glass])]


def build_certificates() -> list[bpy.types.Object]:
    frame_mat = material("cert_frame", "dark_metal", roughness=0.45, metallic=0.4)
    mat_mat = material("cert_paper", "paper", roughness=0.8)
    parts = []
    for i, (x, z, w, h) in enumerate([(-2.25, 2.0, 0.42, 0.54), (-1.7, 2.15, 0.3, 0.24), (-1.7, 1.83, 0.3, 0.24)]):
        parts.append(cube(f"cert_frame_{i}", (w, 0.04, h), (x, -2.52, z), frame_mat))
        parts.append(cube(f"cert_paper_{i}", (w - 0.06, 0.01, h - 0.06), (x, -2.49, z), mat_mat, bevel=0))
    return [join("ix_certificates", parts)]


def build_chair_and_plant() -> list[bpy.types.Object]:
    fabric = material("chair", "dark_metal", roughness=0.85)
    metal = material("chair_metal", "metal", roughness=0.35, metallic=0.7)

    parts = [
        cube("seat", (0.54, 0.52, 0.09), (-0.25, -0.75, 0.47), fabric),
        cube("back", (0.5, 0.09, 0.68), (-0.25, -0.48, 0.85), fabric),
        cylinder("chair_post", 0.035, 0.42, (-0.25, -0.75, 0.24), metal, vertices=12),
    ]
    for i in range(5):
        a = i / 5 * math.tau
        parts.append(
            cube(
                f"caster_{i}",
                (0.05, 0.3, 0.03),
                (-0.25 + math.cos(a) * 0.15, -0.75 + math.sin(a) * 0.15, 0.05),
                metal,
                rotation_z=a,
            )
        )
    chair = join("ix_chair", parts)

    pot = cylinder("pot", 0.17, 0.28, (2.55, 0.9, 0.14), material("pot", "pot", roughness=0.9))
    leaves = []
    for i in range(9):
        a = i / 9 * math.tau
        r = 0.11 + (i % 3) * 0.05
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1,
            radius=0.12,
            location=(2.55 + math.cos(a) * r, 0.9 + math.sin(a) * r, 0.42 + (i % 4) * 0.12),
        )
        leaf = bpy.context.object
        leaf.name = f"leaf_{i}"
        leaf.scale = (1, 1, 1.8)
        leaf.rotation_euler = (0.3, 0, a)
        leaves.append(shade(leaf, material("leaf", "leaf", roughness=0.7)))

    return [chair, join("plant", [pot] + leaves)]


def add_lighting() -> None:
    """
    Lights exist so the exported scene can be baked. The runtime does not import
    them — it rigs its own — but a bake needs them, and keeping them here means
    the bake and the real-time render start from the same intent.
    """
    bpy.ops.object.light_add(type="AREA", location=(1.2, 0.6, 2.6))
    key = bpy.context.object
    key.name = "key"
    key.data.energy = 90
    key.data.size = 2.2
    key.data.color = (0.62, 0.72, 1.0)

    bpy.ops.object.light_add(type="POINT", location=(-1.02, -2.0, 1.15))
    warm = bpy.context.object
    warm.name = "lamp_light"
    warm.data.energy = 32
    warm.data.color = (1.0, 0.66, 0.34)

    bpy.ops.object.light_add(type="AREA", location=(0, -2.0, 1.25))
    screens = bpy.context.object
    screens.name = "screen_bounce"
    screens.data.energy = 24
    screens.data.size = 1.6
    screens.data.color = (0.42, 0.66, 1.0)
    screens.rotation_euler = (math.radians(90), 0, 0)


def unwrap_all() -> None:
    """
    A second UV set, packed into one atlas, so the bake script has somewhere to
    write. Doing it here rather than in the bake script keeps the two runs
    independent — the unwrap is part of the model, not part of the render.
    """
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in meshes:
        if len(obj.data.uv_layers) == 0:
            obj.data.uv_layers.new(name="UVMap")
        if "Bake" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="Bake")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
        obj.data.uv_layers.active = obj.data.uv_layers["Bake"]
    bpy.context.view_layer.objects.active = meshes[0]

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")

    for obj in meshes:
        obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]


def main() -> None:
    reset_scene()

    build_shell()
    build_desk()
    build_monitors()
    build_laptop()
    build_keyboard_and_props()
    build_lamp()
    build_shelf_and_books()
    build_whiteboard()
    build_server_rack()
    build_window()
    build_toronto()
    build_certificates()
    build_chair_and_plant()
    add_lighting()

    try:
        unwrap_all()
    except Exception as exc:  # pragma: no cover - unwrap is best-effort
        print(f"[build_room] unwrap skipped: {exc}", file=sys.stderr)

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
    )

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    tris = sum(len(o.data.loop_triangles) for o in meshes if o.data.loop_triangles or True)
    print(f"[build_room] objects={len(meshes)} materials={len(bpy.data.materials)}")
    print(f"[build_room] wrote {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
