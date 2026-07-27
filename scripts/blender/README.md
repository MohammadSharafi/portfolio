# The room

`assets/room.blend` is the source of truth for the 3D room. Open it, model in
it, save it, then run the export.

```bash
# .blend -> public/models/room.glb   (what the site loads)
blender --background --python scripts/blender/export_room.py

# .blend -> public/models/room-baked.glb + room-bake.png   (the good lighting)
blender --background --python scripts/blender/bake_room.py -- --size 4096 --samples 256
```

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

## Where the blockout came from

`build_room.py` generated the room procedurally and used to feed the site
directly. It is kept because it produced the blockout, and because the layout
reasoning in it — wall positions, what collides with what, why the floor stops
where it does — is worth reading before moving furniture.

```bash
# Regenerate the blockout from scratch. Overwrites assets/room.blend.
blender --background --python scripts/blender/build_room.py -- --blend
```

**It will destroy hand modelling.** It is a starting point, not a build step.
Once a human has moved a vertex, the .blend is the record and the script is
history.

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
