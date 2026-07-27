# The room

`build_room.py` is the source of truth for the 3D room. It builds every object
from code and exports the model the site loads.

```bash
# build the room and export it     -> public/models/room.glb
blender --background --python scripts/blender/build_room.py

# bake the lighting into an atlas  -> public/models/room-baked.glb + room-bake.png
blender --background --python scripts/blender/bake_room.py -- --size 4096 --samples 256

# optional: write a .blend to open and look at, or model on top of
blender --background --python scripts/blender/build_room.py -- --blend
```

The room is a script rather than a saved .blend because a binary file cannot be
reviewed in a diff, cannot be regenerated, and rots the moment someone nudges a
vertex without telling anyone. The cost is that everything has to be
expressible in code — see _Making shapes_ below for what that actually allows,
which is more than boxes.

The runtime prefers the baked room and falls back to the plain one, so you can
export while modelling and bake only when you are happy with the shape.

## The naming contract

This is the one thing that can silently break the site.

The web app finds every interactive object **by mesh name**. Rename `ix_chair`
to `Chair` while modelling and nothing errors: the export succeeds, the site
loads, and the chair just stops turning. Nobody notices until someone looks
closely at a room they have seen a hundred times.

So `export_room.py` refuses to export a scene missing a name the runtime needs,
and tells you what each missing object was for. If it complains, either rename
the object back or change the runtime to match — but do one of them.

**Rules:**

- Anything named `ix_<something>` is wired to the web app. Everything else is
  set dressing and can be renamed, split, merged or deleted freely.
- To make a _new_ object clickable, add its id to `objectIds` in
  `src/room/data/objects.ts` and name the mesh `ix_<id with dashes as
underscores>`. `monitor-health` → `ix_monitor_health`.
- You can split an `ix_` object into several meshes. Name them `ix_chair`,
  `ix_chair_1`, `ix_chair_2` and so on — the runtime matches by prefix, which
  is also how it copes with glTF splitting multi-material meshes on export.
- Set the **object** name, not just the mesh-data name. Blender lets them
  differ, and the exporter has opinions about which one wins.

## Camera stops move separately

Each object has a camera position in `src/room/data/objects.ts`. If you move an
object more than a few centimetres, its stop needs moving too or the camera
will dolly to where it used to be.

Those coordinates are in **glTF space, not Blender space**. Blender is Z-up and
the exporter converts to Y-up, so a point at `(x, y, z)` in Blender arrives in
the browser at `(x, z, -y)`. Getting this wrong is not subtle — the first pass
of these stops was written in Blender coordinates and every one of them aimed
the camera at empty space with the room behind it.

## Texture

Materials can carry a `grain` custom property naming a procedural surface
break-up: `wood`, `fabric`, `plaster`, `pile`, `brushed` or `paper`. Set it in
Blender under Material Properties → Custom Properties.

It is wired in **only during the bake**. The glTF exporter cannot carry a node
graph — it writes white where one is linked, which at one point turned every
wooden and upholstered surface in the room into bare plastic. So the room ships
flat and the bake resolves the grain into the lightmap along with everything
else.

Keep grain frequencies under about 110 cycles/m. The bake writes one 4096 px
atlas shared by every object in the room, which works out around 200 texels/m
on the larger surfaces; anything finer aliases into a shimmer rather than
resolving as texture.

## Making shapes

Boxes and cylinders are not the ceiling. Four helpers cover most of what the
room needs:

- `cube` / `cylinder` / `plane` — bevelled primitives, for anything that really
  is a box.
- `poly(name, verts, faces, ...)` — a mesh from explicit control points. This is
  how anything with a real silhouette gets made: the chair's seat pan and back
  shell are each one cage of about thirty points.
- `smooth(obj, levels, crease=…)` — a subdivision surface. This is the
  difference between a room made of boxes and a room made of things. A bevel
  softens an edge; subdivision changes the shape, and it is what turns a box
  into a cushion. `crease` from 0 to 1 controls how much of the original cage
  survives — low for cushions, high for panels.
- `lathe(name, profile, ...)` — spins a list of (radius, height) pairs around Z,
  for anything turned on a wheel.

A control cage plus `smooth` is how most stylised 3D is actually modelled; it
just happens to be done by dragging points rather than listing them.

## Notes from building this

Things that cost real time, in case they come round again:

- **glTF splits multi-material meshes.** One object with five materials arrives
  as five nodes named `foo`, `foo_1` … `foo_4`. This caused four separate
  bugs that each looked like something else — a tiling texture, a black screen,
  a missing display, a chair that turned one fifth of itself.
- **Two coplanar faces from different objects z-fight.** Upholstery is where it
  bites hardest, because a sofa is one shape assembled from six boxes that all
  want to end in the same place. Sink each cushion a centimetre into what
  carries it.
- **A tilted box pivots about its own centre.** Segments sized to exactly meet
  will open a wedge-shaped gap at every seam once you rotate them.
- **Emission above 1.0 saturates in glTF.** It ships as flat white and loses
  its colour entirely.
- **Smooth, metallic surfaces mirror the room.** A window pane at roughness
  0.05 reflected the lit room back hard enough that the skyline behind it was
  invisible.
