# Room detail audit

Every mesh in `public/models/room.glb`, what is wrong with it, and what has to
happen before it is finished. 158 meshes, 84,860 triangles.

Written because three days of work went into the lightmap pipeline, the aging
masks and the bake gating — infrastructure that had to exist — and almost none
of it into the objects a visitor actually looks at. That was the wrong order.
This document is the list that should have existed first.

---

## Part 1 — the eight faults, with causes

### 1. The desk lamp is blown out and its source is unreadable

**Cause.** The lamp is a *point* light. A point light radiates into a full
sphere, so it lights the wall behind the shade as strongly as the desk in front
of it, and no amount of tuning gives it a defined edge. A desk lamp with a shade
throws a **cone**. There is also a `lamp_beam` cone and an emissive `lamp_mouth`
disc stacked on top of the same source, so three things are all saying "bright"
in the same 10 cm.

**Fix.**
- Replace the point with a **spot light** whose cone angle matches the shade's
  own geometry (`radius1=0.105`, `depth=0.15` → roughly 35° half-angle), aimed
  down the shade's axis. The pool then has an edge, and the edge is evidence of
  where the light came from.
- Drop the total output. The pool should read as bright *relative to the room*,
  not clip to white. Target: desk surface under the lamp around 2–3 stops over
  the floor, not 8.
- Re-tune `lamp_beam` alpha down once the spot exists — the beam is standing in
  for scattering, and with a real cone there is much less work for it to do.
- Same treatment in the browser fallback (`RoomExperience.tsx`), which currently
  runs a `pointLight` at intensity 30.

### 2. The steam orbits the mug instead of rising from it

**Cause, exactly.** `Animations.tsx` does this per frame:

```
wisp.node.rotation.y = Math.sin(...) * 0.22
wisp.node.scale.x = wisp.node.scale.z = 0.4 + fade * 0.85
```

Both a rotation and a scale are applied **about the object's origin**. The steam
wisps are the only animated objects in the room that never had `set_origin`
called on them — the chair has it, the books have it, the keyboard has it — so
each wisp's origin is wherever the join happened to leave it, which is not the
mug's axis. Rotating about a point 4 cm to one side sweeps the wisp in an arc.
That is the circling.

**Fix.**
- `set_origin(wisp, (mug_x, mug_y, DESK_TOP + 0.082))` for every wisp, so the
  origin is on the mug's centre line at the liquid surface. Rotation and scale
  then happen about the column's base, which is where steam is actually pinned.
- Reduce the modelled lateral drift. The wisps currently span 92 mm across an
  86 mm mug — the vapour is wider than the cup it comes from.
- Sway should be a **bend**, not a rigid turn: rotate less and let the modelled
  curve carry the shape.

### 3. The LED coves read as being on the roof

**Cause.** They sit at z = 2.34 on walls that are 5.4 m tall, so they are far
above every object in the room with a large empty wall above them, and the
camera looks down into an open box. There is nothing for them to relate to.

**Fix.**
- Bring the wall runs down to **just above the furniture line** (~1.95 m), so
  each strip reads as mounted above the shelf and above the window rather than
  floating near a ceiling that is never in shot.
- Add the strips the references actually lead with, which are all at
  furniture height: **under each bookshelf shelf**, along the **desk's back
  edge** (exists), behind the **monitor**, and under the **coffee table**.
- Give each run a **channel** — a shallow extruded profile with the emitter
  recessed. A bare glowing line with no fixture is why it reads as a drawn
  stroke rather than a product.
- The wall gradient under each strip is currently linear and even. Real strips
  show individual LED hotspots near the wall and blend further out.

### 4. The laptop is behind the chair

**Cause.** `CHAIR_X = KEY_X = -0.16` and the chair has a tall back. The laptop
sits at x −0.97..−0.61, so the two do not intersect — but from the one camera
the site opens on, the chair's back is nearer and taller and covers it.
`check_furniture` tests for collision, which is the wrong test: the fault is
occlusion, and nothing checks for that.

**Fix.**
- Move the laptop to the desk's **right-hand return**, clear of the chair's
  silhouette from `HOME_STOP`, or angle the chair further so its back no longer
  crosses the laptop.
- Add a `check_occlusion` to `export_room.py`: for each `ix_` interactive
  object, ray-cast from the home camera to its centre and fail if more than
  ~60% of its projected area is blocked. Placement faults that are invisible to
  a collision test have now cost time twice.

### 5. The plants are fake

**Cause.** Each plant is 1,860 triangles spent on **flat blades with no
thickness, no taper, no curl and no variation** — the same extruded profile
repeated and fanned. Flat cards read as paper.

**Fix.** Per plant:
- Give each leaf a **midrib** and a cross-section that tapers to the tip, so it
  catches a highlight along its length instead of shading as one flat value.
- **Curl and droop.** A leaf bends under its own weight; every leaf here is
  straight. Two-axis bend, varying per leaf.
- **Vary the leaves.** Length, width and angle should differ by ±25%; identical
  leaves are the strongest sign of an array modifier.
- **Translucency.** Leaves are thin and lit from behind — needs a subsurface or
  a back-face emission term, which is most of why real foliage glows at the
  edges.
- **Soil.** The pots need a soil surface with a slightly irregular top and a
  darker rim where it meets the pot, not a flat disc.
- Add **dead/yellowing tips** on one plant. Nothing says "alive and owned" like
  imperfect.

### 6. The books have no detail

**Cause.** Shelf books were rebuilt with real construction (square, cover board,
recessed page block) but the **spine artwork is the only thing distinguishing
them**, and only six of them carry it — `ix_book_spine_0..5`. Everything else in
`ix_bookshelf` (17,928 triangles, the single largest object in the room) is
plain coloured boards.

**Fix.**
- **Spine artwork for every book**, not six. Generated from a small set of
  layout templates (title band, author foot, publisher mark) so they differ.
- **Head and tail bands**, the little coloured cloth at the top and bottom of a
  hardback spine. Two-triangle detail that reads instantly as a real book.
- **Vary the block.** Lean some, pull some forward flush with the shelf edge,
  leave a gap. A shelf where every book is upright and flush is a shop display.
- **Dust jackets** on a few — a jacket has a visible fold line at the front
  hinge and sits slightly proud of the boards.
- **Page block texture.** Currently one flat cream. Needs the fine horizontal
  striation of a cut edge, and a slightly warmer tone at the top where dust
  settles (the aging mask already provides this signal — it is not being used
  on the page block).

### 7. The developer equipment is basic

The desk is the subject of the whole site and it holds the least detail per
object of anything in the room.

- **Monitors** (372 tris each): no stand articulation, no ports, no power LED,
  no cable exit, a bezel of uniform thickness, no logo, and the panel is a flat
  quad with no anti-glare sheen or off-axis falloff.
- **Laptop** (1,392): no keyboard on the base at all, no trackpad, no ports, no
  rubber feet, no hinge detail, no vents, a lid of uniform thickness.
- **Keyboard** (1,872): now has legends, but no case seam, no indicator LEDs, no
  USB cable strain relief, no feet detail, and the switch stems are cubes.
- **Mouse** (256): a smoothed dome. No scroll wheel, no button split line, no
  cable or dongle, no side grip.
- **Headphones** (1,104): no ear-pad compression, no headband stitching, no
  hinge, no cable.
- **Server rack** (228): a box with a face. No rails, no rack ears, no unit
  divisions, no drive bays, no status LEDs, no ventilation.
- **Desk phone** (small): no buttons, no speaker grille, no screen bezel.

**Fix.** Each of these needs a pass at the same level the keyboard just got:
real dimensions, the seams and fasteners the object actually has, and one or two
signs of use. Detailed per object in Part 3.

### 8. Three days, and the room still reads simple

Correct, and the evidence is in the triangle budget:

| Object | Triangles | Share | How often looked at |
|---|---:|---:|---|
| `ix_bookshelf` | 17,928 | 21% | background |
| `ix_chair` | 16,840 | 20% | mid |
| `ix_window` | 13,308 | 16% | background |
| **subtotal** | **48,076** | **57%** | |
| every desk prop combined | ~8,000 | 9% | **the subject** |

Fifty-seven per cent of the room's geometry is in three objects nobody looks at,
and the desk — which is what the site is about — has nine per cent. The
bookshelf's triangles are in bevels and subdivision on plain boards, not in
anything readable. That is the imbalance to correct, and it can be corrected
without raising the total: decimate the three, spend it on the desk.

---

## Part 2 — how the checklist is scored

Each object gets a state:

- **OK** — finished, nothing outstanding.
- **THIN** — correct but under-detailed; needs additive work.
- **WRONG** — actively reads as fake or is misplaced; needs a fix before detail.

---

## Part 3 — every object

### The desk and what is on it — the subject of the site

| Object | State | What has to happen |
|---|---|---|
| `desk_top` | THIN | Front edge needs a slight radius and a visible ply/veneer line; the surface needs a wear path where forearms rest. |
| `desk_lip`, `desk_brace` | THIN | Brace needs bolt heads at each joint; lip needs a return so it is not a flat board. |
| `desk_leg_l`, `desk_leg_r` | THIN | Adjustable-height columns need a visible telescoping seam and a levelling foot. |
| `desk_mat` | THIN | Needs a stitched edge, a slight corner curl, and a nap that changes value with view angle. |
| `desk_coffee_ring` | OK | Reads correctly. |
| `desk_clutter` | THIN | Individual items are unresolved blobs; either model them properly or remove. |
| `drawers`, `drawer_face_0..2` | THIN | Faces need a shadow gap between them; currently flush. Add a lock barrel on the top drawer. |
| `drawer_pull_0..2` | THIN | Pulls are bars; need a mounting boss and a slight taper. |
| `drawer_box_1`, `drawer_inner_1`, `drawer_runner_1_*`, `drawer_thing_1_*` | THIN | The one open drawer needs its contents to read — currently three anonymous shapes. |
| `drawer_bolt_*` | OK | |
| `ix_monitor_code`, `ix_monitor_health` | THIN | See §7. Add ports, power LED, cable exit, thinner top bezel than bottom, logo, panel sheen. |
| `ix_monitor_*_display` | THIN | Panel needs off-axis falloff and a very slight matte diffusion; currently a perfect emitter. |
| `arm_base`, `arm_hub`, `arm_post`, `arm_reach_*`, `arm_plate_*` | THIN | Monitor arm needs visible pivots, a tension screw and cable routing along the arm. |
| `cable_monitor_l`, `cable_monitor_r` | THIN | Cables need connectors at both ends and sag that varies. |
| `laptop_base` | **WRONG** | Occluded by the chair (§4). Also has no keyboard, trackpad, ports or feet. |
| `ix_laptop_lid_body`, `ix_laptop_display` | THIN | Lid needs a tapered section, hinge detail and a camera notch. |
| `ix_keyboard` | THIN | Case seam, indicator LEDs, cable strain relief, real switch stems. |
| `ix_keycap_legends` | OK | Just completed. |
| `kb_cable`, `kb_wrist_rest` | THIN | Wrist rest needs compression where wrists sit and a fabric weave. |
| `ix_mouse` | THIN | Scroll wheel, button split, side grip, cable or dongle. |
| `ix_headphones` | THIN | Ear-pad compression against the desk, headband stitching, hinge, cable. |
| `ix_mug`, `mug_second`, `mug_second_well` | THIN | Glaze needs a thickness at the rim and an unglazed foot ring. |
| `steam_0..4` | **WRONG** | Origins are off-axis (§2). Fix origins, reduce drift, bend rather than rotate. |
| `glass_wall`, `glass_water`, `glass_meniscus` | THIN | Needs a base thickness and a slight rim lip; water needs a meniscus that touches the glass. |
| `pen_cup`, `pen_cup_well`, `pen_0..3` | THIN | Pens need clips, tips and different lengths; they currently all stand at one height. |
| `ix_pencil` | THIN | Needs a sharpened cone with exposed graphite and a ferrule. |
| `ix_notebook` | THIN | Needs page edges, an elastic closure and a slightly domed cover. |
| `ix_cv`, `ix_cv_face` | THIN | Should be a sheet with thickness and a curl, not a flat quad. |
| `desk_phone`, `desk_phone_screen`, `desk_phone_camera`, `desk_phone_lens_0..1` | THIN | Needs buttons, a speaker slot, a case, and a screen that is off rather than black. |
| `desk_pot`, `desk_leaf_0..4` | **WRONG** | Flat leaf cards (§5). |
| `lamp` | **WRONG** | Point light, no cone (§1). Geometry also needs a joint at the elbow that reads as adjustable. |
| `lamp_mouth`, `lamp_beam`, `ix_lamp` | THIN | Re-tune once the spot exists. |
| `led_strip` | THIN | Needs a channel and a diffuser (§3). |
| `cables` | THIN | Needs to reach real destinations — currently ends in mid-air. |

### The chair

| Object | State | What has to happen |
|---|---|---|
| `ix_chair` | THIN | 16,840 triangles and still reads as one moulded piece. Needs: a seam between cushion and shell, visible mesh weave on the back, armrest pads distinct from arms, a gas-lift with a real cylinder and collar, castors that are wheels rather than lozenges, and a tilt mechanism under the seat. Decimate the smooth shell to fund this. |

### The bookshelf wall

| Object | State | What has to happen |
|---|---|---|
| `ix_bookshelf`, `bookshelf`, `shelf_top` | THIN | 17,928 triangles in plain boards. Decimate. Add shelf pin holes, a visible back panel, and a slight sag on the longest shelf. |
| `ix_book_spine_0..5` | THIN | Spine art exists for six books only (§6). |
| all other books in `ix_bookshelf` | **WRONG** | Coloured boards with no artwork. Needs the full §6 treatment. |
| `shelf_binder_0..2` | THIN | Binders need ring mechanisms visible at the spine and a label window. |
| `shelf_box` | THIN | Needs a lid line and a label. |
| `plant_2`, `plant_3` | **WRONG** | Flat leaf cards (§5). |
| `award_base`, `award_plate` | THIN | Needs an engraved plate that reads at distance. |
| `certificate_frames`, `ix_certificates_0..2` | THIN | Frames need a mount board and glass with a reflection. |

### The lounge end

| Object | State | What has to happen |
|---|---|---|
| `sofa` | THIN | Needs cushion seams, piping, a visible frame under the arm, and compression where the cushions meet. |
| `coffee_table` | THIN | Needs a visible joinery detail at the leg and a lower shelf that carries something. |
| `side_table` | THIN | Same. |
| `rug`, `rug_body` | OK | Reads well. |
| `floor_lamp` | THIN | Shade needs a seam and a visible bulb through the paper; base needs weight. |
| `plant_1` | **WRONG** | Flat leaf cards (§5). |
| `guitar`, `guitar_capo`, `guitar_pick_0..1` | THIN | Needs strings (currently none readable), fret markers, a bridge, and a sound-hole rosette. |
| `ix_server_rack` | THIN | Rails, rack ears, unit divisions, drive bays, status LEDs, ventilation. |

### The room shell

| Object | State | What has to happen |
|---|---|---|
| `wall_back`, `wall_left` | THIN | Need a subtle roller texture and a slight value gradient; currently perfectly flat paint. |
| `floor`, `floorboards` | THIN | Boards need end joints staggered, a bevel at each edge and variation in tone per board. |
| `skirting_back`, `skirting_left` | THIN | Needs a profile rather than a rectangle, and a shadow gap at the floor. |
| `ix_window`, `window_frame`, `window_latch`, `blind` | THIN | 13,308 triangles, mostly in the exterior. Decimate. Frame needs a putty line and a sill with a drip edge. Blind needs slats or a fabric weave. |
| `door`, `door_hinges` | THIN | Needs a real panel profile, a handle with a backplate, and a strike plate. |
| `radiator` | THIN | Needs a valve, a bleed screw and pipes that enter the floor. |
| `socket_0..1`, `light_switch` | THIN | Need screw heads and a faceplate bevel. |
| `coat_hook` | OK | |
| `clock` | THIN | Needs a second hand and a glass reflection. |
| `wall_art` | THIN | Needs a mount board and non-zero frame depth. |
| `ix_whiteboard`, `ix_whiteboard_face` | THIN | Needs a pen tray with pens in it and ghosting from previous writing. |
| `ix_sticky_notes` | THIN | Notes should curl at one corner. |
| `bin_body`, `bin_rim`, `bin_well`, `bin_paper_0..2`, `paper_missed` | OK | |
| `led_cove_shelf`, `led_cove_window` | **WRONG** | Height and no fixture (§3). |
| `cn_tower`, `sky_occluder*` | OK | Background only. |

---

## Part 4 — order of work

1. **The four WRONG items first** — steam origins, LED cove height, laptop
   occlusion, lamp cone. These are faults, not missing detail, and every one of
   them is visible in the first frame the site shows.
2. **Decimate the three background hogs** — bookshelf, chair shell, window
   exterior. Frees roughly 25,000 triangles.
3. **Spend it on the desk** — monitors, laptop, mouse, headphones, keyboard
   case, server rack. This is what the site is about.
4. **Plants** — all three, properly, as one pass.
5. **Books** — spine art for every volume, plus lean and gap variation.
6. **The shell** — floorboards, skirting, walls, window frame.
7. **Then, and only then, bake.**
