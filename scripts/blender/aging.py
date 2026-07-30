"""
The masks that make a room look lived in, derived from geometry alone.

Three greyscale channels, baked into one atlas on the same UVs as the lightmap:

    R  ambient occlusion   how enclosed a point is
    G  dust               how much settles and stays there
    B  wear               where hands and sleeves have taken the finish off

Nothing here is painted. Every channel is computed from the shape of the mesh
at bake time, which is the only reason this is maintainable: a new object added
to `build_room.py` inherits dust on its top and wear on its corners without
anyone authoring a mask for it, and without a texture per object.

Why this could not be done with the room's ordinary textures. Those are shared
tiles — one wood map, one plaster map, repeating every half metre across every
object that is wood or plaster. That is what keeps the download small, and it
is also why they cannot express "the *top* of this shelf" or "the *front edge*
of that desk": a tile has no idea where on the object it landed. These masks
need the opposite arrangement, a unique unwrapped position per point, which is
exactly what the lightmap's UV1 atlas already provides. So they ride along with
it and cost one more image, not one more image per object.

The one thing worth understanding is how convex and concave are told apart on
low-poly geometry, because the usual answer does not work here. Curvature from
`Geometry > Pointiness` is per-vertex, and on a cube every vertex is an
identical corner — it returns a constant and no edge is found. The Bevel node
does work: it returns the normal a rounded version of the surface would have,
so comparing it against the true normal lights up every edge, convex and
concave alike. Ambient occlusion then separates them, since a convex edge is
exposed and a concave one is buried. Wear wants the exposed ones; grime, if it
is ever wanted, is the same mask the other way up.
"""

from __future__ import annotations

import bpy

# How far the Bevel node looks for an edge. Roughly the radius a real edge wears
# to after a few years of forearms and sleeves — a couple of millimetres. Larger
# reads as a chamfer someone designed rather than damage that accumulated.
EDGE_RADIUS = 0.0035

# The Bevel/normal difference is small even at a hard 90 degree corner, so it is
# amplified into a usable mask. Tuned so a right angle reaches roughly 1.0 and a
# shallow one stays near zero.
EDGE_GAIN = 3.4

# Where hands go. A plateau over the heights people actually touch — desk tops,
# drawer pulls, chair arms, shelf fronts — falling off smoothly to nothing at
# the floor and the ceiling. Without it the top edge of every skirting board and
# the corner of the ceiling wear at the same rate as the desk, which is the tell
# that a wear mask was applied by an algorithm rather than by use.
REACH_LOW = (0.06, 0.58)
REACH_HIGH = (1.30, 2.30)

# Dust does not accumulate on the floor: it gets walked on, and the rug is
# vacuumed. Everything above ankle height keeps what settles on it.
FLOOR_CLEAR = (0.05, 0.28)

# How sharply dust falls off as a surface tilts away from level. Squared, so a
# 45 degree slope holds about half of what a level one does, and a vertical wall
# holds none.
DUST_FALLOFF = 2.0

# Where hands actually land, as soft spheres in world space. The height plateau
# above says "somewhere a person could reach"; these say "the six places this
# person reaches every day" — the keyboard, the desk's leaning edge, the chair,
# the sofa's near arm, the door handle, the coffee table. Wear concentrates in
# them, and dust is wiped out of them, which is the difference between a mask
# that says "used" and one that says "weathered evenly like a cliff face".
TOUCH_ZONES = (
    ((0.15, -1.95, 0.80), 0.50),   # keyboard and mouse
    ((-0.45, -1.80, 0.79), 0.40),  # desk front edge, where forearms lean
    ((0.45, -0.81, 0.62), 0.50),   # chair seat and arms
    ((-0.75, 1.55, 0.55), 0.45),   # sofa's near arm
    ((-2.27, -2.50, 1.02), 0.28),  # door handle
    ((0.25, 0.50, 0.40), 0.62),    # coffee table top
)

# Moisture: the slight permanent darkening where mopping and humidity live,
# in the first hand-span above the floor.
MOISTURE_BAND = (0.02, 0.14)


def _math(tree, operation: str, value=None, *, clamp: bool = False, location=(0, 0)):
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = operation
    node.use_clamp = clamp
    node.location = location
    if value is not None:
        node.inputs[1].default_value = value
    return node


def _range(tree, from_min, from_max, *, location=(0, 0)):
    """A smooth 0..1 ramp between two values."""
    node = tree.nodes.new("ShaderNodeMapRange")
    node.interpolation_type = "SMOOTHSTEP"
    node.clamp = True
    node.inputs["From Min"].default_value = from_min
    node.inputs["From Max"].default_value = from_max
    node.location = location
    return node


def _zone(tree, position_socket, centre, radius, *, location=(0, 0)):
    """1.0 inside a soft world-space sphere, 0.0 outside it."""
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "SUBTRACT"
    offset.inputs[1].default_value = centre
    offset.location = location
    tree.links.new(position_socket, offset.inputs[0])
    distance = tree.nodes.new("ShaderNodeVectorMath")
    distance.operation = "LENGTH"
    distance.location = (location[0] + 170, location[1])
    tree.links.new(offset.outputs["Vector"], distance.inputs[0])
    inside = _range(tree, radius * 0.55, radius, location=(location[0] + 340, location[1]))
    inside.inputs["To Min"].default_value = 1.0
    inside.inputs["To Max"].default_value = 0.0
    tree.links.new(distance.outputs["Value"], inside.inputs["Value"])
    return inside.outputs["Result"]


def _noise(tree, position_socket, scale, out_min, out_max, *, location=(0, 0)):
    """World-space fractal noise remapped to a multiplier band."""
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 4.0
    noise.inputs["Roughness"].default_value = 0.55
    noise.location = location
    tree.links.new(position_socket, noise.inputs["Vector"])
    band = _range(tree, 0.0, 1.0, location=(location[0] + 200, location[1]))
    band.inputs["To Min"].default_value = out_min
    band.inputs["To Max"].default_value = out_max
    tree.links.new(noise.outputs["Fac"], band.inputs["Value"])
    return band.outputs["Result"]


def mask_material() -> bpy.types.Material:
    """
    One material that emits the three masks as colour, for an EMIT bake.

    Shared by every object rather than built per material, and it can be:
    every input is geometry — normal, position, occlusion, bevel — so nothing
    about which material a surface *had* changes what these masks say about it.
    That is what makes the pass automatic. It also means the bake is one pass
    over the room rather than one per material.
    """
    mat = bpy.data.materials.new("aging_masks")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()

    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    geometry.location = (-1400, 0)

    # --- ambient occlusion, which both other channels lean on ---------------
    occlusion = tree.nodes.new("ShaderNodeAmbientOcclusion")
    occlusion.samples = 16
    occlusion.inside = False
    # Half a metre. Long enough that a shelf shades the desk under it, short
    # enough that the room's own walls do not darken everything in it.
    occlusion.inputs["Distance"].default_value = 0.5
    occlusion.location = (-1150, 260)

    # --- dust ---------------------------------------------------------------
    # Only what faces up collects anything, so the mask starts as the vertical
    # component of the normal and falls off with tilt.
    normal_z = tree.nodes.new("ShaderNodeSeparateXYZ")
    normal_z.location = (-1150, -120)
    tree.links.new(geometry.outputs["Normal"], normal_z.inputs["Vector"])

    facing = _math(tree, "MAXIMUM", 0.0, location=(-950, -120))
    tree.links.new(normal_z.outputs["Z"], facing.inputs[0])
    tilt = _math(tree, "POWER", DUST_FALLOFF, clamp=True, location=(-780, -120))
    tree.links.new(facing.outputs["Value"], tilt.inputs[0])

    position = tree.nodes.new("ShaderNodeSeparateXYZ")
    position.location = (-1150, -340)
    tree.links.new(geometry.outputs["Position"], position.inputs["Vector"])

    above_floor = _range(tree, *FLOOR_CLEAR, location=(-950, -340))
    tree.links.new(position.outputs["Z"], above_floor.inputs["Value"])

    settled = _math(tree, "MULTIPLY", location=(-600, -180))
    tree.links.new(tilt.outputs["Value"], settled.inputs[0])
    tree.links.new(above_floor.outputs["Result"], settled.inputs[1])

    # Dust needs somewhere open to fall from. A surface sealed inside a drawer
    # faces up just as much as the desk does and never sees any.
    exposed = _math(tree, "MULTIPLY", location=(-420, -180))
    tree.links.new(settled.outputs["Value"], exposed.inputs[0])
    tree.links.new(occlusion.outputs["AO"], exposed.inputs[1])

    # --- wear ---------------------------------------------------------------
    bevel = tree.nodes.new("ShaderNodeBevel")
    bevel.samples = 8
    bevel.inputs["Radius"].default_value = EDGE_RADIUS
    bevel.location = (-1150, 520)

    # How far the rounded normal has swung away from the true one. Zero on a
    # flat face, largest on a sharp edge.
    alignment = tree.nodes.new("ShaderNodeVectorMath")
    alignment.operation = "DOT_PRODUCT"
    alignment.location = (-950, 520)
    tree.links.new(bevel.outputs["Normal"], alignment.inputs[0])
    tree.links.new(geometry.outputs["Normal"], alignment.inputs[1])

    edge = _math(tree, "SUBTRACT", location=(-780, 520))
    edge.inputs[0].default_value = 1.0
    tree.links.new(alignment.outputs["Value"], edge.inputs[1])
    sharp = _math(tree, "MULTIPLY", EDGE_GAIN, clamp=True, location=(-600, 520))
    tree.links.new(edge.outputs["Value"], sharp.inputs[0])

    # Convex or concave. The Bevel difference cannot tell them apart — both
    # bend the normal — but occlusion can: a convex edge sticks out into open
    # air and a concave one is a corner nothing reaches. Only the exposed ones
    # get rubbed.
    convex = _math(tree, "MULTIPLY", location=(-420, 520))
    tree.links.new(sharp.outputs["Value"], convex.inputs[0])
    tree.links.new(occlusion.outputs["AO"], convex.inputs[1])

    reachable_low = _range(tree, *REACH_LOW, location=(-950, 300))
    tree.links.new(position.outputs["Z"], reachable_low.inputs["Value"])
    reachable_high = _range(tree, *REACH_HIGH, location=(-950, 120))
    reachable_high.inputs["To Min"].default_value = 1.0
    reachable_high.inputs["To Max"].default_value = 0.0
    tree.links.new(position.outputs["Z"], reachable_high.inputs["Value"])

    reach = _math(tree, "MULTIPLY", location=(-780, 200))
    tree.links.new(reachable_low.outputs["Result"], reach.inputs[0])
    tree.links.new(reachable_high.outputs["Result"], reach.inputs[1])

    # --- the touch zones ----------------------------------------------------
    # A soft union of the places hands land daily. Wear concentrates here;
    # dust is wiped from here.
    zone_sockets = [
        _zone(tree, geometry.outputs["Position"], centre, radius,
              location=(-2200, 900 + index * 220))
        for index, (centre, radius) in enumerate(TOUCH_ZONES)
    ]
    zones = zone_sockets[0]
    for index, socket in enumerate(zone_sockets[1:]):
        union = _math(tree, "MAXIMUM", location=(-1500, 900 + index * 120))
        tree.links.new(zones, union.inputs[0])
        tree.links.new(socket, union.inputs[1])
        zones = union.outputs["Value"]

    # Background reach is scaled down so the zones dominate: a chair arm wears
    # through its finish years before the bookshelf's mid-rail does.
    ambient_reach = _math(tree, "MULTIPLY", 0.45, location=(-600, 200))
    tree.links.new(reach.outputs["Value"], ambient_reach.inputs[0])
    touch = _math(tree, "MAXIMUM", location=(-420, 240))
    tree.links.new(ambient_reach.outputs["Value"], touch.inputs[0])
    tree.links.new(zones, touch.inputs[1])

    # --- world-space variation ----------------------------------------------
    # The single loudest procedural tell is uniformity: real wear waxes and
    # wanes across a surface for reasons nobody can reconstruct. Low-frequency
    # world noise modulates both channels, and a sparse high-threshold band
    # adds the occasional isolated blotch — a stain with no visible cause,
    # which is what most real stains are.
    wear_var = _noise(tree, geometry.outputs["Position"], 0.55, 0.72, 1.22,
                      location=(-2200, -700))
    dust_var = _noise(tree, geometry.outputs["Position"], 2.2, 0.78, 1.18,
                      location=(-2200, -950))
    blotch_noise = tree.nodes.new("ShaderNodeTexNoise")
    blotch_noise.inputs["Scale"].default_value = 1.4
    blotch_noise.inputs["Detail"].default_value = 3.0
    blotch_noise.location = (-2200, -1200)
    tree.links.new(geometry.outputs["Position"], blotch_noise.inputs["Vector"])
    blotch_band = _range(tree, 0.67, 0.72, location=(-2000, -1200))
    tree.links.new(blotch_noise.outputs["Fac"], blotch_band.inputs["Value"])
    # Gated by the same up-facing and floor terms as the dust it rides with.
    # Ungated, the blotches landed on vertical plaster and every wall in the
    # room grew pale clouds — a stain has to have somewhere to settle *from*.
    blotch_settled = _math(tree, "MULTIPLY", location=(-1900, -1350))
    tree.links.new(blotch_band.outputs["Result"], blotch_settled.inputs[0])
    tree.links.new(settled.outputs["Value"], blotch_settled.inputs[1])
    blotch = _math(tree, "MULTIPLY", 0.15, location=(-1800, -1200))
    tree.links.new(blotch_settled.outputs["Value"], blotch.inputs[0])

    worn_flat = _math(tree, "MULTIPLY", location=(-240, 520))
    tree.links.new(convex.outputs["Value"], worn_flat.inputs[0])
    tree.links.new(touch.outputs["Value"], worn_flat.inputs[1])
    worn = _math(tree, "MULTIPLY", clamp=True, location=(-100, 520))
    tree.links.new(worn_flat.outputs["Value"], worn.inputs[0])
    tree.links.new(wear_var, worn.inputs[1])

    # Dust: varied by the noise, wiped where hands live, plus the blotches
    # (which are dirt, so they ride the dust channel and inherit its tinting).
    swept = _math(tree, "MULTIPLY", 0.85, location=(-420, -60))
    tree.links.new(zones, swept.inputs[0])
    keep = _math(tree, "SUBTRACT", location=(-300, -120))
    keep.inputs[0].default_value = 1.0
    tree.links.new(swept.outputs["Value"], keep.inputs[1])
    dust_wiped = _math(tree, "MULTIPLY", location=(-180, -180))
    tree.links.new(exposed.outputs["Value"], dust_wiped.inputs[0])
    tree.links.new(keep.outputs["Value"], dust_wiped.inputs[1])
    dust_varied = _math(tree, "MULTIPLY", location=(-60, -180))
    tree.links.new(dust_wiped.outputs["Value"], dust_varied.inputs[0])
    tree.links.new(dust_var, dust_varied.inputs[1])
    dust_final = _math(tree, "ADD", clamp=True, location=(60, -180))
    tree.links.new(dust_varied.outputs["Value"], dust_final.inputs[0])
    tree.links.new(blotch.outputs["Value"], dust_final.inputs[1])

    # --- moisture -----------------------------------------------------------
    # The hand-span above the floor lives a slightly darker life: mop water,
    # humidity, shoe scuffs. Carried in the occlusion channel, which the
    # runtime already reads as ambient dirt.
    floor_band = _range(tree, *MOISTURE_BAND, location=(-950, 460))
    floor_band.inputs["To Min"].default_value = 1.0
    floor_band.inputs["To Max"].default_value = 0.0
    tree.links.new(position.outputs["Z"], floor_band.inputs["Value"])
    damp = _math(tree, "MULTIPLY", 0.30, location=(-780, 460))
    tree.links.new(floor_band.outputs["Result"], damp.inputs[0])
    dry = _math(tree, "SUBTRACT", location=(-600, 460))
    dry.inputs[0].default_value = 1.0
    tree.links.new(damp.outputs["Value"], dry.inputs[1])
    ao_damp = _math(tree, "MULTIPLY", location=(-420, 400))
    tree.links.new(occlusion.outputs["AO"], ao_damp.inputs[0])
    tree.links.new(dry.outputs["Value"], ao_damp.inputs[1])

    # --- pack and emit ------------------------------------------------------
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.location = (0, 200)
    tree.links.new(ao_damp.outputs["Value"], combine.inputs["Red"])
    tree.links.new(dust_final.outputs["Value"], combine.inputs["Green"])
    tree.links.new(worn.outputs["Value"], combine.inputs["Blue"])

    # Emission, because an EMIT bake writes shader output straight to the image
    # with no lighting involved. It is the standard way to get an arbitrary
    # value out of Cycles and into a texture.
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    emission.location = (220, 200)
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])

    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (420, 200)
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])

    return mat
