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

## Design system

Colour is authored in OKLCH so light and dark stay perceptually matched, exposed
as CSS custom properties and mapped to Tailwind utilities through `@theme inline`.
Dark mode is class-driven and applied by an inline script in `index.html` before
first paint, so there is no flash; the choice persists in `localStorage` and
falls back to the OS preference.

`prefers-reduced-motion` is honoured in two places: CSS neutralises animation and
transition durations, and `useReducedMotion` lets components skip entrance
animations outright rather than playing a faster version of them.

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

## Licence

MIT for the source. The written content, CV and photographs are © Mohammad Sharafi.
