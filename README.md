# Mohammad Sharafi — Portfolio

Personal portfolio site. React 18 + TypeScript + Vite, styled with Tailwind CSS v4 and animated with Motion.

**Live:** https://mohammadsharafi.vercel.app

---

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
```

| Script              | What it does                       |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Vite dev server with HMR           |
| `npm run build`     | Typecheck, then build to `build/`  |
| `npm run preview`   | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit`                     |
| `npm run lint`      | ESLint, including `jsx-a11y` rules |
| `npm run format`    | Prettier write                     |
| `npm test`          | Vitest run                         |
| `npm run verify`    | Everything CI runs, in order       |

## Layout

```
src/
├── data/          Content: profile, projects, experience, skills, credentials…
├── components/    Section components, plus a small ui/ primitive set
├── hooks/         useTheme, useActiveSection, useReducedMotion
├── lib/           Theme persistence, contact-form logic, cn()
└── styles/        globals.css — Tailwind entry, design tokens, utilities
```

Content lives in `src/data/` rather than inside components, so updating a job,
project or skill is a one-file edit and the components stay presentational.
Every array is typed and covered by `src/data/content.test.ts`, which enforces
things like unique project slugs, valid repo URLs, and awards that carry an
issuer and a year.

## The room pipeline

The 3D room is built by a script, not modelled by hand, and shipped as one glTF
plus two baked atlases.

```
scripts/blender/
├── build_room.py     Builds every object, material and light. Exports room.glb
├── grain_maps.py     Synthesises the tiling surface maps packed into the GLB
├── aging.py          The dust / wear / occlusion masks, derived from geometry
├── bake_room.py      Bakes the lightmap and the aging atlas. Run after a change
├── render_hero.py    Offline Cycles stills for the hero and OG images
├── export_room.py    The checks the build runs, and a .blend export path
└── tonemap.py        The one view transform shared by bake and preview
```

Rebuild the model and then the bake:

```bash
blender --background --python scripts/blender/build_room.py --
```

```bash
blender --background --python scripts/blender/bake_room.py -- --size 4096 --samples 128
```

The bake produces `room-lightmap.jpg` (irradiance) and `room-aging.png` (dust,
wear and occlusion). Both are indexed by a UV1 atlas generated during the bake,
so they are produced in one run and are only valid together — the runtime gates
both on a hash of the `room.glb` they came from and ignores a stale pair rather
than showing an older room.

### What is automatic, and what is not

Dust, edge wear and occlusion are computed from geometry at bake time and need
no per-object authoring: a new object added to `build_room.py` gets dust on its
upward faces and wear on its exposed edges at reachable heights, with nothing to
remember. Surface finish is the same — a material that does not name a `grain`
is given one from its own roughness and metalness, so the default is detail
rather than a flat value.

Three constraints are real and are not going to be solved by more code:

- **Curved and thin geometry cannot be unwrapped without distortion.** The
  blind's slats, the guitar body, the radiator fins and the cables all carry
  regions at well under their own average texel density. Splitting into flatter
  islands was tried and made it worse, because more islands means more of the
  mesh near a seam. The maps on UV0 are repeating noise, where this is
  invisible; `check_uv_stretch` holds UV1 to a much tighter bound because the
  masks there are positional.
- **Wear is placed by height and exposure, not by use.** The mask has no idea
  which drawer is opened daily. A convex edge within arm's reach wears; one at
  the ceiling does not. That is a good approximation of a real room and it is
  still an approximation.
- **The screens cannot be rendered offline from the model alone.** They are
  canvases painted by the browser at runtime. `render_hero.py` reads what the
  dev server dumped rather than reimplementing them, so a hero render needs
  `npm run dev` to have been visited at least once.

## Design system

Colour is authored in OKLCH so light and dark stay perceptually matched, exposed
as CSS custom properties and mapped to Tailwind utilities through `@theme inline`.
Dark mode is class-driven and applied by an inline script in `index.html` before
first paint, so there is no flash; the choice persists in `localStorage` and
falls back to the OS preference.

`prefers-reduced-motion` is honoured in two places: CSS neutralises animation and
transition durations, and `useReducedMotion` lets components skip entrance
animations outright rather than playing a faster version of them.

## The journey

The hero is a scroll-driven journey through six 3D chapters — a village in Iran,
the exam years, Isfahan University of Technology, Tehran, the crossing to
Türkiye, and the desk the work happens at today. They are not six scenes: they
are one world, laid out along the +X axis with the workspace at the origin, and
scroll drives a single camera down it. Scrolling forward is literally travelling
toward the present.

```
src/three/
├── experience.ts   Renderer, camera rail, travelling light rig, render loop
├── journey.ts      Procedural geometry and camera stop for each chapter
├── room.ts         The workspace — the last chapter, at the origin
├── environment.ts  Procedural HDR environment, prefiltered by PMREMGenerator
├── screens.ts      Canvas textures for the three monitors
├── primitives.ts   Shared material and mesh helpers
└── palette.ts      Every colour in the world, so it reads as one film
```

The narrative copy lives in `src/data/journey.ts` and renders in the DOM, not on
the canvas — as a cross-faded caption over the scene, and as a plain vertical
timeline when there is no WebGL to travel through. `src/data/journey.test.ts`
asserts one 3D stage per written chapter, so adding copy without adding a stage
fails the build rather than narrating an empty frame.

Some things worth knowing about how it is built:

- **Three lights carry all six chapters.** Each stage declares its own ambient,
  key and accent rig, and the renderer eases between them as the camera travels.
  A light per chapter would mean twenty of them and a shader recompile at every
  transition; this way the transitions read as one continuous change in the time
  of day. Small warm sources — a lit window, a bare bulb, an office floor, an
  arcade — are emissive materials picked up by the bloom pass instead.
- **The shadow camera follows the camera.** A directional shadow frustum wide
  enough to cover a hundred and sixty units would turn every shadow into a
  staircase, so it tracks the active chapter at fourteen units across.
- **The environment map is generated, not loaded.** `environment.ts` builds a
  cold sky dome, a warm ground bounce and a bright horizon band, then prefilters
  it with `PMREMGenerator` at genuinely high dynamic range. Three's stock
  `RoomEnvironment` is a white studio box — correct for a product shot, wrong for
  every chapter here, where it made metal reflect a ceiling that does not exist.
- **The horizontal field of view is held constant.** Every shot is composed
  horizontally, and `fov` is vertical, so a portrait phone would otherwise crop
  the sides off exactly the part that was composed.
- **Camera easing is frame-rate independent.** The scroll smoothing folds in the
  frame time, so the journey takes the same wall-clock time to travel on a 120Hz
  display as on a 60Hz one.

The whole thing is an enhancement layer:

- `React.lazy` keeps Three.js out of the initial bundle entirely
- No WebGL → the flat hero and the written timeline render instead
- `detectQuality()` scales shadows, pixel ratio and post-processing rather than
  excluding devices
- `prefers-reduced-motion` disables idle motion and parallax
- The canvas is `aria-hidden`; every chapter it renders also exists in the DOM,
  in order, whether or not the camera has reached it
- Rendering pauses when the canvas scrolls off-screen or the tab is hidden

Every chapter is procedural rather than a modelled asset. If you export baked
`.glb` scenes from Blender, load them in `experience.ts` and drop the matching
`build*()` calls — the camera rail, light rig and scroll wiring stay as they are.

## Project artwork

Project cards render generated SVG rather than photography. Each project declares
a `pattern` and a `hue` in `src/data/projects.ts`, and `ProjectArtwork` draws it
deterministically from the slug — no remote image requests, and it scales to any
viewport.

## Regenerating the social preview image

`public/og-image.png` is rendered from `scripts/og-image.html`. To update it,
edit that file and screenshot it at 1200×630 with any headless browser, e.g.:

```bash
chromium --headless --window-size=1200,712 \
  --screenshot=public/og-image.png scripts/og-image.html
```

## Deployment

Vercel, configured in `vercel.json` (build output goes to `build/`). Any static
host works — the output is plain files. CI runs formatting, lint, typecheck,
tests and a build on every push and pull request.

### Changing the domain

The deployed origin lives in one place, `src/lib/site.ts`. A Vite plugin reads it
to fill the `%SITE_URL%` placeholders in `index.html` (canonical, Open Graph,
Twitter, JSON-LD) and to generate `robots.txt` and `sitemap.xml` at build time,
so pointing the site at a custom domain is a one-line edit with no stale URLs
left behind.

## Licence

MIT for the source. The written content, CV and photographs are © Mohammad Sharafi.
