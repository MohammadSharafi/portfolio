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

# look at the lighting in ~35s, without baking -> scripts/blender/preview.png
blender --background --python scripts/blender/preview_room.py -- --samples 48

# re-export from the last atlas, no re-bake, in under a minute
blender --background --python scripts/blender/bake_room.py -- --reuse-atlas
```

## Look at the light before you bake it

`preview_room.py` renders one Cycles still from the camera stop the site opens
on, through the same tone map the atlas ships with. Use it for anything to do
with light.

A 4096 bake is the better part of an hour, writes a multi-megabyte GLB and
needs a dev-server restart to judge. That is far too slow a loop to balance a
room by — the first version of this room's lighting was set by editing energies
and re-baking blind, and it came out a flat grey diorama because nobody could
see what any single change did. The first preview render caught four of six
lights pointing the wrong way.

`--view desk|shelf|wide` moves the camera; one three-quarter view hides half
the room.

The bake prints progress every eight objects with an estimate of what is left.
Do not filter that out of the pipe: a silent forty-minute operator cannot be
told apart from a hung one.

## The view transform

Cycles bakes unbounded scene-linear radiance; an image file holds 0..1.
`tonemap.py` owns the mapping, and both the bake and the preview go through it
so they cannot disagree about what "too bright" means.

Baking straight into an 8-bit image — which is what this did first — hard-clips
at 1.0, so the lamp, the screens, the LED strips and the sky all resolved to the
same flat white with no shape and no colour. Worse, the clip is per-channel, so
warm highlights _shifted hue_ on the way there. The bake now writes a float
buffer and rolls the top end off with the same ACES curve three.js would have
applied — which is the right one, because the baked room draws with
`toneMapped: false`, so the atlas _is_ the final image.

Filmic curves desaturate as they compress, so a saturation step follows the
curve. Without it, coloured light converges on white exactly where it is
strongest, which is precisely where the colour was meant to live.

Two things about writing the atlas are worth knowing, because both are silent:

- **A float-buffer image saves as 16-bit with no sRGB encode**, whatever
  `colorspace_settings` says. So the PNG is written here by hand rather than
  through `Image.save` — otherwise the atlas ships linear values that the
  browser decodes as sRGB, about two stops too dark and at triple the size.
- **The atlas ships inside the GLB as JPEG**, not PNG. It is the whole
  download, and a lossless 4096 lightmap takes the GLB past 12 MB.

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

## Surfaces

`grain_maps.py` generates the room's textures — wood, fabric, carpet pile,
plaster, brushed metal and paper — as tiling images, and `material(…,
grain="wood")` wires them into base colour, roughness and normal. They are
packed into the GLB, so the model on the web is the textured one. Nothing is
downloaded and there is no licence to track.

The noise is built in the frequency domain: a random spectrum with a 1/f
falloff, inverse-transformed. That is periodic by construction, so every map
tiles with no seam, and shaping the spectrum anisotropically is the whole
difference between wood and brushed aluminium.

Two things about this are easy to get wrong and both are silent:

- **Texture density has to be normalised per object.** Smart UV Project packs
  each object's islands into 0..1, so a 3.5 m desk and a 6 cm mug both fill the
  whole map — the desk gets grain the size of a fingerprint and the mug gets
  floorboards. `texture_uvs()` measures each object's real surface area against
  the area its UVs occupy and scales to a fixed half-metre tile. Check it with
  the UV density readout rather than by eye; every object should land on 0.50 m.
- **Anything the runtime paints must keep its 0..1 UV.** The monitors, the
  laptop screen, the whiteboard, the sticky notes, the CV page and the book
  spines are addressed by `Screens.tsx` as whole images. `PAINTED` excludes
  them from both the unwrap and the rescale; without that a monitor shows its
  dashboard four times over.

`--flat` exports without the maps, which is useful when judging a silhouette
that grain would otherwise disguise.

## More notes from building this

- **Assigning `colorspace_settings.name` resets an image's buffer.** Fill the
  pixels _after_ setting the colorspace, never before. The obvious order —
  fill, then label — throws the fill away, and every map in the GLB ships as a
  flat 1 KB PNG of nothing with no error anywhere.
- **`image.pixels` needs `image.update()`** before the buffer counts as written.
- **The glTF exporter treats a dot in an image name as a file extension**, so
  `rough_0.45` and `rough_0.85` both arrive called `rough_0`.
- **A box takes the lean; a plane takes the lean plus 90°.** A plane is born
  flat and has to be stood up first. Giving a box a plane's rotation lays it
  down, which looks like an odd base rather than like a mistake.
- **Camera stops go stale silently.** They live in `src/room/data/objects.ts`
  in glTF coordinates while the model is authored in Blender coordinates, and
  nothing connects a stop to the object it names. Rearranging the desk left six
  of fifteen aiming at where their object used to be — clicking the lamp flew
  the camera 2.4 m past it and framed bare desk. `check_stops` in
  `export_room.py` catches this now, and `check_clearance` catches the matching
  problem in the model: props standing inside one another.
