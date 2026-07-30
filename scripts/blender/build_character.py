"""
The desk robot: a 12 cm character Mohammad built, exported on its own.

    blender --background --python scripts/blender/build_character.py --

Output: public/models/character.glb

Its own file rather than part of the room, for two reasons. The room is baked
and the character moves, so it can never receive baked light and has to be lit
dynamically — mixing them would mean re-baking the room every time the
character changed. And a separate asset can be streamed after the room, which
is what lets the tour render before the game code has loaded.

**Rigid parts, not a skinned mesh.** Every joint is its own object with its
origin *at the pivot*, parented into a tree, so the runtime animates it by
rotating nodes and nothing needs a skeleton, weights or an animation clip. That
is the whole reason this is a robot: a convincing humanoid needs skinning and
inverse kinematics, neither of which a procedural pipeline produces well, while
a robot is hard-surface parts hinged together — exactly what scripted geometry
is good at, and exactly what three.js can drive without an animation system.

Scale, from the plan: 12 cm total, head about a third of it. The desk at 79 cm
is 6.6 times its height, which is the ratio a four-storey building has to a
person.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_GLB = os.path.join(ROOT, "public", "models", "character.glb")

sys.path.insert(0, HERE)

import build_room  # noqa: E402

# The palette.
#
# One accent colour that appears nowhere else in the room — the plan is
# specific about this and it is the difference between a character you can pick
# out against a busy rug and one you lose. The room is blue-grey, purple, wood
# and warm lamp light, so the accent is a cool mint: warm orange would vanish
# into the lamp pool, and any blue would vanish into everything else.
SHELL = (0.520, 0.545, 0.585, 1.0)      # brushed casing
SHELL_DARK = (0.118, 0.128, 0.150, 1.0)  # joints, undersides, panel gaps
RUBBER = (0.055, 0.058, 0.068, 1.0)      # feet and grips
MINT = (0.180, 0.980, 0.760, 1.0)        # the accent: visor, chest light
BRASS = (0.620, 0.470, 0.180, 1.0)       # screw heads and the antenna tip

_made: dict[str, bpy.types.Material] = {}


def paint(name: str, colour, *, roughness=0.45, metallic=0.0, emission=0.0):
    """A material by literal colour, since these are not the room's palette."""
    if name in _made:
        return _made[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = colour
        bsdf.inputs["Emission Strength"].default_value = emission
    _made[name] = mat
    return mat


def hinge(obj: bpy.types.Object, pivot: tuple[float, float, float], parent=None):
    """
    Move an object's origin to its pivot and hang it off its parent.

    The origin is the whole point. A limb rotated about the centre of its own
    mesh swings its top end through whatever it is attached to; rotated about
    the joint it behaves like a limb. Every part below sets its pivot at the
    joint it turns on, so the runtime can animate the entire character by
    assigning Euler angles and nothing else.
    """
    build_room.set_origin(obj, pivot)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def attach(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    """
    Hang a part off a parent without moving it.

    Every part has to end up in the tree, not just the ones that bend. A visor
    left unparented sits exactly where it was modelled while the head it belongs
    to turns away from it — and because the character is assembled from sixty
    rigid pieces rather than skinned, anything that misses the hierarchy is
    simply left behind. It is silent, too: a root-level scale reaches only what
    is parented to the root, which is how a 12 cm robot came out 16 cm tall.
    """
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def screw(name: str, at: tuple[float, float, float], axis: str = "y"):
    """A screw head. Manufactured objects are assembled; seamless ones are toys."""
    spin = {
        "y": (math.radians(90), 0, 0),
        "x": (0, math.radians(90), 0),
        "z": (0, 0, 0),
    }[axis]
    return build_room.cylinder(
        name, 0.0016, 0.0009, at, paint("bot_screw", BRASS, roughness=0.3, metallic=0.85),
        vertices=6, rotation=spin,
    )


def build() -> bpy.types.Object:
    build_room.reset_scene()

    shell = paint("bot_shell", SHELL, roughness=0.34, metallic=0.55)
    dark = paint("bot_dark", SHELL_DARK, roughness=0.55, metallic=0.30)
    rubber = paint("bot_rubber", RUBBER, roughness=0.92)
    glow = paint("bot_glow", MINT, roughness=0.25, emission=6.0)

    parts: list[bpy.types.Object] = []

    # ---------------------------------------------------------------- root
    # An empty at the feet, so the runtime can place the character by its
    # ground contact rather than by the middle of its body.
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.object
    root.name = "bot_root"

    # ---------------------------------------------------------------- hips
    hips = build_room.cube("bot_hips", (0.040, 0.028, 0.018), (0, 0, 0.046), shell, bevel=0.004)
    hinge(hips, (0, 0, 0.040), root)
    parts.append(hips)
    # The waist seam, and the bolts that close it.
    parts.append(attach(build_room.cube("bot_waist_seam", (0.042, 0.030, 0.0022), (0, 0, 0.055), dark, bevel=0), hips))
    for sx in (-0.014, 0.014):
        parts.append(attach(screw(f"bot_hip_screw_{sx}", (sx, -0.0145, 0.046)), hips))

    # --------------------------------------------------------------- torso
    torso = build_room.cube("bot_torso", (0.044, 0.032, 0.034), (0, 0, 0.074), shell, bevel=0.006)
    hinge(torso, (0, 0, 0.057), hips)
    parts.append(torso)

    # A chest light in the accent colour, recessed behind a bezel. This is the
    # character's read at distance — the plan asks for a silhouette you can
    # identify as a black shape, and a single bright point does most of that
    # work once the room is dark.
    parts.append(attach(
        build_room.cylinder("bot_chest_bezel", 0.0092, 0.004, (0, -0.017, 0.078), dark,
                            vertices=16, rotation=(math.radians(90), 0, 0)), torso))
    parts.append(attach(
        build_room.cylinder("bot_chest_light", 0.0062, 0.003, (0, -0.0185, 0.078), glow,
                            vertices=16, rotation=(math.radians(90), 0, 0)), torso))
    # Panel seams down the chest, and a vent stack on the back.
    for dz in (0.062, 0.090):
        parts.append(attach(build_room.cube(f"bot_chest_seam_{dz}", (0.046, 0.034, 0.0018), (0, 0, dz), dark, bevel=0), torso))
    for i in range(4):
        parts.append(attach(
            build_room.cube(f"bot_vent_{i}", (0.026, 0.0022, 0.0032), (0, 0.0165, 0.064 + i * 0.008), dark, bevel=0), torso))
    # A tool mount on the back — where the torch and the data jack live.
    parts.append(attach(build_room.cube("bot_pack", (0.030, 0.010, 0.022), (0, 0.021, 0.076), dark, bevel=0.003), torso))
    parts.append(attach(
        build_room.cylinder("bot_pack_port", 0.0035, 0.006, (0.009, 0.026, 0.080), glow,
                            vertices=10, rotation=(math.radians(90), 0, 0)), torso))
    # Twin pistons bracing the pack against the waist — the hydraulic read
    # every small robot needs, and the first thing visible from behind the
    # follow camera.
    for sx in (-0.010, 0.010):
        parts.append(attach(
            build_room.cylinder(f"bot_piston_{sx}", 0.0016, 0.020, (sx, 0.0195, 0.063), shell,
                                vertices=8, rotation=(math.radians(14), 0, 0)), torso))
    # A belly plate under the chest light, and two status pips beside it.
    parts.append(attach(
        build_room.cube("bot_belly", (0.036, 0.004, 0.010), (0, -0.0165, 0.063), dark, bevel=0.002), torso))
    for i, sx in enumerate((-0.012, 0.012)):
        parts.append(attach(
            build_room.cylinder(f"bot_status_{i}", 0.0018, 0.0024, (sx, -0.0185, 0.0635),
                                paint(f"bot_status_c_{i}", ((1.0, 0.62, 0.2, 1.0), MINT)[i],
                                      roughness=0.3, emission=7.0),
                                vertices=8, rotation=(math.radians(90), 0, 0)), torso))

    # ---------------------------------------------------------------- head
    # A third of total height, per the plan. Realistic proportions vanish at
    # 12 cm against a busy room; a big head reads at any distance.
    neck = build_room.cylinder("bot_neck", 0.008, 0.008, (0, 0, 0.094), dark, vertices=12)
    hinge(neck, (0, 0, 0.091), torso)
    parts.append(neck)

    head = build_room.cube("bot_head", (0.042, 0.038, 0.036), (0, 0, 0.117), shell, bevel=0.008)
    hinge(head, (0, 0, 0.098), neck)
    parts.append(head)

    # The visor. A face, or at least eyes — a featureless shape is a cursor,
    # not a character.
    parts.append(attach(
        build_room.cube("bot_visor_recess", (0.036, 0.006, 0.017), (0, -0.018, 0.119), dark, bevel=0.002), head))
    parts.append(attach(
        build_room.cube("bot_visor", (0.030, 0.004, 0.011), (0, -0.0205, 0.119), glow, bevel=0.002), head))
    # Two brighter pips inside the visor, which is what makes it read as eyes
    # rather than as a light bar.
    for sx in (-0.0088, 0.0088):
        parts.append(attach(
            build_room.cylinder(f"bot_eye_{sx}", 0.0032, 0.0022, (sx, -0.0215, 0.119),
                                paint("bot_eye", (0.85, 1.0, 0.95, 1.0), roughness=0.2, emission=12.0),
                                vertices=12, rotation=(math.radians(90), 0, 0)), head))
    # Ear housings, a crown seam and the antenna.
    for sx in (-0.022, 0.022):
        parts.append(attach(
            build_room.cylinder(f"bot_ear_{sx}", 0.0068, 0.005, (sx, 0.002, 0.117), dark,
                                vertices=12, rotation=(0, math.radians(90), 0)), head))
        parts.append(attach(screw(f"bot_ear_screw_{sx}", (sx * 1.06, 0.002, 0.117), axis="x"), head))
    parts.append(attach(build_room.cube("bot_crown_seam", (0.044, 0.040, 0.0018), (0, 0, 0.130), dark, bevel=0), head))
    # A brow shade over the visor: it deepens the recess, and at speed the
    # head reads as leaning into the run rather than staring.
    parts.append(attach(
        build_room.cube("bot_brow", (0.038, 0.006, 0.0032), (0, -0.019, 0.1285), shell, bevel=0.001), head))

    antenna = build_room.cylinder("bot_antenna", 0.0012, 0.026, (0.012, 0.010, 0.147), dark, vertices=6)
    antenna.rotation_euler = (0.16, -0.10, 0)
    parts.append(attach(antenna, head))
    parts.append(attach(
        build_room.cylinder("bot_antenna_tip", 0.0026, 0.0026, (0.016, 0.014, 0.160),
                            paint("bot_tip", MINT, roughness=0.2, emission=9.0), vertices=10), head))

    # ---------------------------------------------------------------- arms
    limbs: dict[str, bpy.types.Object] = {}
    for side, sx in (("l", -1.0), ("r", 1.0)):
        shoulder = build_room.cylinder(
            f"bot_shoulder_{side}", 0.0082, 0.010, (sx * 0.026, 0, 0.086), dark,
            vertices=12, rotation=(0, math.radians(90), 0),
        )
        hinge(shoulder, (sx * 0.024, 0, 0.086), torso)
        parts.append(shoulder)
        # A pauldron cap over the joint. Bare hinge cylinders read as pins;
        # a cap reads as armour, and it is the widest point of the
        # silhouette from behind.
        parts.append(attach(
            build_room.cube(f"bot_pauldron_{side}", (0.010, 0.014, 0.008), (sx * 0.0315, 0, 0.089),
                            shell, bevel=0.003), shoulder))

        upper = build_room.cube(f"bot_arm_{side}", (0.011, 0.011, 0.024), (sx * 0.030, 0, 0.074), shell, bevel=0.003)
        hinge(upper, (sx * 0.030, 0, 0.086), shoulder)
        parts.append(upper)

        elbow = build_room.cylinder(
            f"bot_elbow_{side}", 0.0058, 0.011, (sx * 0.030, 0, 0.062), dark,
            vertices=10, rotation=(0, math.radians(90), 0),
        )
        hinge(elbow, (sx * 0.030, 0, 0.062), upper)
        parts.append(elbow)

        fore = build_room.cube(f"bot_forearm_{side}", (0.0098, 0.0098, 0.022), (sx * 0.030, 0, 0.050), shell, bevel=0.003)
        hinge(fore, (sx * 0.030, 0, 0.062), elbow)
        parts.append(fore)
        parts.append(attach(screw(f"bot_fore_screw_{side}", (sx * 0.0355, 0, 0.055), axis="x"), fore))
        parts.append(attach(
            build_room.cylinder(f"bot_wrist_{side}", 0.0062, 0.0024, (sx * 0.030, 0, 0.0415), dark,
                                vertices=10), fore))

        # A three-fingered gripper. It has no hands in the carrying sense — the
        # plan's whole shoulder-charge mechanic depends on that — but it needs
        # something at the end of the arm that reads as able to plug in.
        hand = build_room.cube(f"bot_hand_{side}", (0.010, 0.011, 0.008), (sx * 0.030, 0, 0.036), dark, bevel=0.002)
        hinge(hand, (sx * 0.030, 0, 0.040), fore)
        parts.append(hand)
        for i, fx in enumerate((-0.0032, 0.0032)):
            parts.append(attach(
                build_room.cube(f"bot_finger_{side}_{i}", (0.0026, 0.0032, 0.0072),
                                (sx * 0.030 + fx, -0.0035, 0.030), shell, bevel=0.0008), hand))
        limbs[f"arm_{side}"] = hand

    # ---------------------------------------------------------------- legs
    for side, sx in (("l", -1.0), ("r", 1.0)):
        hip = build_room.cylinder(
            f"bot_hipjoint_{side}", 0.0072, 0.010, (sx * 0.014, 0, 0.040), dark,
            vertices=12, rotation=(0, math.radians(90), 0),
        )
        hinge(hip, (sx * 0.014, 0, 0.040), hips)
        parts.append(hip)

        thigh = build_room.cube(f"bot_thigh_{side}", (0.012, 0.013, 0.020), (sx * 0.014, 0, 0.030), shell, bevel=0.003)
        hinge(thigh, (sx * 0.014, 0, 0.040), hip)
        parts.append(thigh)

        knee = build_room.cylinder(
            f"bot_knee_{side}", 0.0062, 0.012, (sx * 0.014, 0, 0.020), dark,
            vertices=10, rotation=(0, math.radians(90), 0),
        )
        hinge(knee, (sx * 0.014, 0, 0.020), thigh)
        parts.append(knee)

        shin = build_room.cube(f"bot_shin_{side}", (0.0108, 0.0118, 0.018), (sx * 0.014, 0, 0.011), shell, bevel=0.003)
        hinge(shin, (sx * 0.014, 0, 0.020), knee)
        parts.append(shin)

        # Feet with a tread. The character spends its life on floorboards, a
        # rug's pile and a desk mat, and the sole is the part of it closest to
        # every one of those surfaces.
        # A knee cap on the joint's front, and a piston bracing the calf.
        parts.append(attach(
            build_room.cube(f"bot_kneecap_{side}", (0.0095, 0.004, 0.008), (sx * 0.014, -0.0085, 0.020),
                            shell, bevel=0.002), knee))
        parts.append(attach(
            build_room.cylinder(f"bot_calf_piston_{side}", 0.0014, 0.014, (sx * 0.014, 0.0075, 0.013),
                                dark, vertices=8, rotation=(math.radians(10), 0, 0)), shin))
        # A plate over the hip joint, mirroring the pauldron.
        parts.append(attach(
            build_room.cube(f"bot_hipplate_{side}", (0.006, 0.012, 0.010), (sx * 0.0205, 0, 0.040),
                            shell, bevel=0.002), hip))

        foot = build_room.cube(f"bot_foot_{side}", (0.015, 0.024, 0.005), (sx * 0.014, -0.003, 0.0035), dark, bevel=0.002)
        hinge(foot, (sx * 0.014, 0, 0.005), shin)
        parts.append(foot)
        # A toe bumper: the foot's leading edge, and the part that sells a
        # step when the foot flexes.
        parts.append(attach(
            build_room.cube(f"bot_toe_{side}", (0.0135, 0.004, 0.0042), (sx * 0.014, -0.0155, 0.0042),
                            shell, bevel=0.0015), foot))
        for i in range(4):
            parts.append(attach(
                build_room.cube(f"bot_tread_{side}_{i}", (0.015, 0.0030, 0.0022),
                                (sx * 0.014, -0.011 + i * 0.0058, 0.0012), rubber, bevel=0), foot))

    # Scaled so the body — crown of the head, not the antenna tip — lands on the
    # plan's 12 cm. That number is not decoration: every movement figure is
    # derived from it, and the desk at 79 cm being 6.6 times the character's
    # height is what makes it read as a four-storey cliff rather than a step.
    crown = max(
        (obj.matrix_world @ v.co).z
        for obj in parts
        if "antenna" not in obj.name
        for v in obj.data.vertices
    )
    root.scale = (0.120 / crown,) * 3

    for obj in parts:
        obj.select_set(False)
    return root


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_character")
    parser.add_argument("--blend", metavar="PATH", nargs="?", const=os.path.join(HERE, "character.blend"))
    args = parser.parse_args(argv)

    build()

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph).to_mesh()
        evaluated.calc_loop_triangles()
        tris += len(evaluated.loop_triangles)
        obj.evaluated_get(depsgraph).to_mesh_clear()

    bpy.context.view_layer.update()
    height = max(
        (obj.matrix_world @ v.co).z for obj in meshes for v in obj.data.vertices
    )
    body = max(
        (obj.matrix_world @ v.co).z
        for obj in meshes if "antenna" not in obj.name
        for v in obj.data.vertices
    )
    print(
        f"[build_character] {len(meshes)} parts, {tris} triangles, "
        f"body {body * 100:.1f} cm, {height * 100:.1f} cm to the antenna tip"
    )
    # The plan's budget. It is on screen constantly and it is the only thing in
    # the room that moves, so it is the one mesh whose cost is paid every frame.
    if tris > 5000:
        print(f"[build_character] over the 5,000 triangle budget by {tris - 5000}", file=sys.stderr)

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
        print(f"[build_character] wrote {args.blend}")
        return

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
    )
    print(f"[build_character] wrote {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
