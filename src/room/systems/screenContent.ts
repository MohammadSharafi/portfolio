import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { projects } from '@/data/projects';
import { stats } from '@/data/stats';
import { experience } from '@/data/experience';
import { profile } from '@/data/profile';
import { skillGroups } from '@/data/skills';
import { awards, education } from '@/data/credentials';
import { quality } from '../engine/quality';

/**
 * Everything with writing on it in the room.
 *
 * Drawn to 2D canvases and uploaded as textures rather than modelled, because
 * text as geometry is both enormously expensive and unreadable at these sizes.
 * The content comes from `src/data` — the same source the written site renders
 * — so a screen cannot show a figure the CV disagrees with.
 *
 * These replace the grey placeholder rectangles the Blender model ships with.
 * A box standing in for a paragraph reads as unfinished from the first glance;
 * the point of a room like this is that everything in it is legible when you
 * lean in.
 */

const FONT_UI = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/**
 * How many texture pixels are drawn per layout pixel.
 *
 * The screens were authored at 1024×576 for a monitor 62 cm wide, and the
 * camera stop for that monitor now stands under a metre from it — close enough
 * that a 1024 texture stretched over the panel puts roughly one texel on every
 * two screen pixels, and 15px UI labels come out soft and slightly wrong at
 * their edges. Text is the one thing in this room a visitor is asked to *read*,
 * so it is the last thing that should be the blurriest.
 *
 * Rendering at 2× and letting the mipmap chain resolve it is much simpler than
 * re-laying-out every screen at double the coordinates: the context is scaled
 * once here, so every existing draw call keeps its own units and simply lands
 * on four times as many pixels. The low tier stays at 1× — a machine that is
 * dropping frames does not need four megapixels of whiteboard.
 */
const SCALE = quality().tier === 'low' ? 1 : 2;

function surface(width: number, height: number, background: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d')!;
  // Everything below this line draws in layout units and is scaled up on the
  // way to the texture.
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/**
 * How a painted quad's UVs are oriented relative to the room.
 *
 * `plane()` in `build_room.py` gives every quad the same local UVs, so which way
 * the drawing lands is decided entirely by the rotation that stands the quad up
 * — and the desk and the left-hand wall need different rotations. There is no
 * single correction that is right for both.
 *
 * - `as-drawn` — U runs right, V runs up. Nothing to do.
 * - `mirror-u` — the desk surfaces. Their quads face the room across +Z, and
 *   looking down +Z puts world +X on the left, so they sample U back to front.
 * - `flip-v` — the left-hand wall. Standing a quad up to face +X leaves U
 *   running to screen-right correctly but sends V *downward*.
 *
 * Corrected here rather than by negative-scaling the geometry, which inverts
 * winding order and culls the face entirely — which is exactly what the first
 * attempt at this did.
 *
 * A vertical flip is easy to misread as a mirror, and that cost real time here:
 * the whiteboard was first diagnosed as needing `mirror-u` and given it, which
 * turned a vertical flip into a 180° rotation. The tell is the letters —
 * upside-down text renders `n` as `u` and `p` as `b` while leaving the
 * left-to-right order of the line alone. Check a line's word order before
 * reaching for a mirror.
 */
type Orientation = 'as-drawn' | 'mirror-u' | 'flip-v';

function finish(canvas: HTMLCanvasElement, orientation: Orientation = 'as-drawn') {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // Mipmapped minification, now that the texture is drawn at 2×. Without a
  // chain, a supersampled canvas seen from across the room aliases *worse*
  // than the 1× one did — every high-contrast edge in a code listing crawls as
  // the camera moves. `LinearMipmapLinearFilter` is what makes the extra
  // resolution a gain at every distance rather than only at the close-up.
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;

  if (orientation === 'mirror-u') {
    texture.wrapS = RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }

  if (orientation === 'flip-v') {
    texture.wrapT = RepeatWrapping;
    texture.repeat.y = -1;
    texture.offset.y = 1;
  }

  return texture;
}

/** Wraps text to a width and returns the y the caller should carry on from. */
function paragraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let cursor = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    ctx.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Monitor 1 — the clinical work. A dashboard, not a screenshot of one.
 *
 * Everything numeric on it is either from the CV or explicitly labelled as
 * sample. That distinction matters more here than anywhere else in the room:
 * this is the screen that claims healthcare experience, and a plausible-looking
 * chart of invented patient data on a portfolio is the kind of detail that
 * turns a strong claim into a liability. The throughput curve says "sample" on
 * its own axis; the latency figures are the real before-and-after from the API
 * work, and the tiles are counts I can point at a commit for.
 */
export function clinicalScreen() {
  const W = 1024;
  const H = 576;
  const { canvas, ctx } = surface(W, H, '#0b1220');

  // --- chrome --------------------------------------------------------------
  ctx.fillStyle = '#111c2f';
  ctx.fillRect(0, 0, W, 54);
  ctx.fillStyle = '#4d9fff';
  ctx.font = `600 20px ${FONT_UI}`;
  ctx.fillText('EHR AI Clinical Assistant', 26, 35);

  ctx.fillStyle = 'rgba(74,222,128,0.14)';
  roundRect(ctx, W - 268, 16, 242, 26, 13);
  ctx.fill();
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(W - 250, 29, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `500 13px ${FONT_MONO}`;
  ctx.fillText('SMART on FHIR · connected', W - 238, 34);

  // --- throughput ----------------------------------------------------------
  ctx.fillStyle = '#0f1a2c';
  roundRect(ctx, 26, 78, 600, 250, 10);
  ctx.fill();
  ctx.fillStyle = '#e6edf7';
  ctx.font = `500 15px ${FONT_UI}`;
  ctx.fillText('Cohort throughput', 44, 106);
  ctx.fillStyle = '#5b6b83';
  ctx.font = `400 12px ${FONT_UI}`;
  ctx.fillText('sample data — not a real cohort', 178, 106);

  // Gridlines first, so the curve is drawn over them. Without any reference
  // the sparkline was a squiggle; four rules turn it into a chart.
  ctx.strokeStyle = 'rgba(127,146,173,0.12)';
  ctx.lineWidth = 1;
  for (let row = 0; row <= 3; row += 1) {
    const y = 136 + row * 56;
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(600, y);
    ctx.stroke();
  }

  const points = [0.32, 0.41, 0.38, 0.52, 0.61, 0.58, 0.72, 0.79, 0.74, 0.88, 0.94, 0.91];
  const plotX = (index: number) => 48 + (index / (points.length - 1)) * 552;
  const plotY = (value: number) => 306 - value * 170;

  ctx.beginPath();
  points.forEach((value, index) => {
    if (index === 0) ctx.moveTo(plotX(index), plotY(value));
    else ctx.lineTo(plotX(index), plotY(value));
  });
  ctx.strokeStyle = '#4d9fff';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const fill = ctx.createLinearGradient(0, 130, 0, 306);
  fill.addColorStop(0, 'rgba(77,159,255,0.26)');
  fill.addColorStop(1, 'rgba(77,159,255,0.02)');
  ctx.lineTo(600, 306);
  ctx.lineTo(48, 306);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // The last reading, called out — a chart with no current value is a shape.
  ctx.fillStyle = '#0b1220';
  ctx.beginPath();
  ctx.arc(plotX(points.length - 1), plotY(points.at(-1)!), 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4d9fff';
  ctx.beginPath();
  ctx.arc(plotX(points.length - 1), plotY(points.at(-1)!), 4, 0, Math.PI * 2);
  ctx.fill();

  // --- tiles ---------------------------------------------------------------
  const tiles = [
    ['123+', 'endpoints', '#4d9fff'],
    ['OAuth2', 'token vault', '#a78bfa'],
    ['HIPAA', 'compliant', '#4ade80'],
    ['0', 'security incidents', '#4ade80'],
  ];
  tiles.forEach((tile, index) => {
    const x = 654;
    const y = 78 + index * 64;
    ctx.fillStyle = '#0f1a2c';
    roundRect(ctx, x, y, 344, 54, 8);
    ctx.fill();
    ctx.fillStyle = tile[2]!;
    roundRect(ctx, x, y + 12, 3, 30, 1.5);
    ctx.fill();
    ctx.fillStyle = '#e6edf7';
    ctx.font = `600 22px ${FONT_UI}`;
    ctx.fillText(tile[0]!, x + 18, y + 35);
    ctx.fillStyle = '#7f92ad';
    ctx.font = `400 15px ${FONT_UI}`;
    ctx.fillText(tile[1]!, x + 120, y + 35);
  });

  // --- integrations and latency -------------------------------------------
  ctx.fillStyle = '#0f1a2c';
  roundRect(ctx, 26, 348, 600, 200, 10);
  ctx.fill();
  ctx.fillStyle = '#e6edf7';
  ctx.font = `500 15px ${FONT_UI}`;
  ctx.fillText('Integrations', 44, 378);
  const rows = [
    ['Cerner / Oracle Health', 'live'],
    ['Mayo Clinic Platform', 'live'],
    ['GCP Cloud Run', 'live'],
    ['FastAPI gateway', 'live'],
  ];
  rows.forEach((row, index) => {
    const y = 410 + index * 32;
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(52, y - 5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9d6e8';
    ctx.font = `400 16px ${FONT_UI}`;
    ctx.fillText(row[0]!, 68, y);
    ctx.fillStyle = '#4a5b73';
    ctx.font = `400 13px ${FONT_MONO}`;
    ctx.fillText(row[1]!, 560, y);
  });

  // The one figure on this screen a reader can check against the CV: response
  // times halved, 800ms to 400ms. Drawn as two bars because the *ratio* is the
  // claim, and two numbers side by side make it in a way a sentence does not.
  ctx.fillStyle = '#0f1a2c';
  roundRect(ctx, 654, 348, 344, 200, 10);
  ctx.fill();
  ctx.fillStyle = '#e6edf7';
  ctx.font = `500 15px ${FONT_UI}`;
  ctx.fillText('API response time', 672, 378);

  const bars = [
    ['before', 800, '#4a5b73'],
    ['after', 400, '#4ade80'],
  ] as const;
  bars.forEach(([label, value, colour], index) => {
    const y = 404 + index * 58;
    ctx.fillStyle = '#7f92ad';
    ctx.font = `400 13px ${FONT_UI}`;
    ctx.fillText(label, 672, y + 14);
    ctx.fillStyle = 'rgba(127,146,173,0.10)';
    roundRect(ctx, 738, y, 200, 20, 10);
    ctx.fill();
    ctx.fillStyle = colour;
    roundRect(ctx, 738, y, (value / 800) * 200, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#c9d6e8';
    ctx.font = `500 13px ${FONT_MONO}`;
    ctx.fillText(`${value}ms`, 948, y + 15);
  });

  return finish(canvas, 'mirror-u');
}

/**
 * Monitor 2 — the editor, and the work it is showing.
 *
 * It used to be a bare code listing. That was atmospheric and said nothing:
 * the panel this monitor opens is the projects list, and the screen behind it
 * showed a camera easing function, so leaning in taught a visitor nothing
 * about the thing they had just been told they were looking at.
 *
 * Now it is an editor with its explorer open, and the explorer is the actual
 * project list from `src/data/projects` — the same source the panel reads. The
 * code in the pane is from this room's own renderer, which is the one project
 * a visitor can verify by standing in it.
 */
export function codeScreen() {
  const W = 1024;
  const H = 576;
  const { canvas, ctx } = surface(W, H, '#0d1117');

  const RAIL = 250;

  // --- title bar -----------------------------------------------------------
  ctx.fillStyle = '#151b23';
  ctx.fillRect(0, 0, W, 40);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((colour, index) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(26 + index * 20, 20, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#7d8590';
  ctx.font = `400 14px ${FONT_MONO}`;
  ctx.fillText('framing.ts — portfolio-room', 108, 25);

  // --- explorer ------------------------------------------------------------
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 40, RAIL, H - 40);
  ctx.fillStyle = '#6e7681';
  ctx.font = `600 11px ${FONT_UI}`;
  ctx.fillText('EXPLORER', 20, 66);

  // Straight from the project data, so a project added to the CV appears on
  // the monitor without anyone remembering to redraw it.
  const shown = projects.slice(0, 9);
  shown.forEach((project, index) => {
    const y = 92 + index * 30;
    const live = project.slug === 'portfolio-room';
    if (live) {
      ctx.fillStyle = '#161e2b';
      ctx.fillRect(0, y - 16, RAIL, 26);
      ctx.fillStyle = '#4d9fff';
      ctx.fillRect(0, y - 16, 2, 26);
    }
    // A folder glyph, drawn rather than typed: the box-drawing characters a
    // font might not have are exactly the ones that render as tofu.
    ctx.fillStyle = live ? '#4d9fff' : '#57606a';
    roundRect(ctx, 20, y - 9, 11, 9, 1.5);
    ctx.fill();

    ctx.fillStyle = live ? '#e6edf7' : '#8b949e';
    ctx.font = `${live ? 500 : 400} 13px ${FONT_UI}`;
    // Truncated by measurement rather than by character count — proportional
    // type makes "Encrypted Payments Core" and "NodeFlow AI" very different
    // widths at the same length.
    let label = project.title;
    while (ctx.measureText(label).width > RAIL - 58 && label.length > 4) {
      label = label.slice(0, -1);
    }
    ctx.fillText(label + (label === project.title ? '' : '…'), 40, y);
  });

  ctx.fillStyle = '#30363d';
  ctx.fillRect(RAIL, 40, 1, H - 40);

  // --- the code ------------------------------------------------------------
  const lines: Array<Array<[string, string]>> = [
    [['// a stop is a direction and a margin —', '#8b949e']],
    [['// the distance is solved, never authored', '#8b949e']],
    [
      ['export function ', '#ff7b72'],
      ['resolveFraming', '#d2a8ff'],
      ['(', '#c9d1d9'],
    ],
    [
      ['  framing, bounds, aspect', '#79c0ff'],
      [') {', '#c9d1d9'],
    ],
    [
      ['  const ', '#ff7b72'],
      ['halfV', '#79c0ff'],
      [' = Math.tan(fov / 2);', '#c9d1d9'],
    ],
    [
      ['  const ', '#ff7b72'],
      ['halfH', '#79c0ff'],
      [' = halfV * aspect;', '#c9d1d9'],
    ],
    [['', '#c9d1d9']],
    [['  // fit both ways, take the further', '#8b949e']],
    [
      ['  const ', '#ff7b72'],
      ['d', '#79c0ff'],
      [' = Math.', '#c9d1d9'],
      ['max', '#d2a8ff'],
      ['(fitV, fitH);', '#c9d1d9'],
    ],
    [['', '#c9d1d9']],
    [
      ['  return ', '#ff7b72'],
      ['{ target, position: ', '#c9d1d9'],
    ],
    [['    add(target, scale(dir, d)) };', '#c9d1d9']],
    [['}', '#c9d1d9']],
  ];

  ctx.font = `400 17px ${FONT_MONO}`;
  lines.forEach((line, index) => {
    const y = 84 + index * 26;
    ctx.fillStyle = '#484f58';
    ctx.fillText(String(index + 1).padStart(2, ' '), RAIL + 18, y);
    let x = RAIL + 54;
    for (const [text, colour] of line) {
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  });

  // --- terminal ------------------------------------------------------------
  ctx.fillStyle = '#161b22';
  ctx.fillRect(RAIL + 1, H - 92, W - RAIL - 1, 92);
  ctx.fillStyle = '#7d8590';
  ctx.font = `400 14px ${FONT_MONO}`;
  ctx.fillText('$ npm run verify', RAIL + 20, H - 62);
  ctx.fillStyle = '#3fb950';
  // Deliberately no test count. It was "✓ 61 tests" and the suite has grown
  // twice since — a number nobody can remember to update is a number that ends
  // up lying, and this room's whole argument is that its figures are checkable.
  ctx.fillText('✓ tests · lint · typecheck · build', RAIL + 20, H - 36);
  ctx.fillStyle = '#7d8590';
  ctx.fillText('$ ', RAIL + 20, H - 12);
  ctx.fillStyle = '#3fb950';
  ctx.fillRect(RAIL + 38, H - 26, 9, 16);

  return finish(canvas, 'mirror-u');
}

/** The laptop — a terminal with the verifiable numbers. */
export function terminalScreen() {
  const W = 1024;
  const H = 640;
  const { canvas, ctx } = surface(W, H, '#07090e');

  ctx.font = `400 20px ${FONT_MONO}`;
  let y = 52;
  const write = (text: string, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillText(text, 30, y);
    y += 30;
  };

  write('$ whoami', '#6ee7b7');
  write(profile.name.toLowerCase().replace(/\s+/g, '-'), '#c9d6e8');
  y += 12;
  write('$ ./metrics --verify', '#6ee7b7');
  for (const stat of stats) {
    write(`  ✓ ${stat.prefix ?? ''}${stat.value}${stat.suffix}  ${stat.label}`, '#8fd4ff');
  }
  y += 12;
  write('$ cat current-role.txt', '#6ee7b7');
  write(`  ${experience[0]?.role ?? ''} · ${experience[0]?.company ?? ''}`, '#c9d6e8');
  write(`  ${experience[0]?.period ?? ''}`, '#7f92ad');
  y += 12;
  write('$ status', '#6ee7b7');
  write(`  ${profile.availability.toLowerCase()}`, '#fbbf24');
  ctx.fillStyle = '#6ee7b7';
  ctx.fillText('$ ', 30, y);
  ctx.fillRect(52, y - 15, 11, 19);

  const texture = finish(canvas, 'mirror-u');
  // Where the prompt ended up, so the blinking caret can be drawn over it
  // rather than at a guessed offset. The terminal grows from the top and its
  // length depends on how many stats and roles the CV has, so the position is
  // not a constant anyone can write down.
  texture.userData['promptY'] = y;
  return texture;
}

/**
 * The whiteboard — the architecture, drawn and labelled.
 *
 * This replaces six grey rectangles in the model that were standing in for
 * boxes on a diagram. An unlabelled box is not a diagram; it is a note saying
 * a diagram should go here.
 */
export function whiteboardTexture() {
  const W = 1024;
  const H = 720;
  const { canvas, ctx } = surface(W, H, '#eef1f6');

  ctx.fillStyle = '#1f2933';
  ctx.font = `600 34px ${FONT_UI}`;
  ctx.fillText('Clinical AI — request path', 44, 66);
  ctx.strokeStyle = '#c3ccd8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(44, 84);
  ctx.lineTo(W - 44, 84);
  ctx.stroke();

  const node = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    sub: string,
    tint: string
  ) => {
    ctx.fillStyle = tint;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = '#33414f';
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 10);
    ctx.stroke();
    ctx.fillStyle = '#16202b';
    ctx.font = `600 24px ${FONT_UI}`;
    ctx.fillText(title, x + 18, y + 38);
    ctx.fillStyle = '#4a5867';
    ctx.font = `400 18px ${FONT_UI}`;
    ctx.fillText(sub, x + 18, y + 66);
  };

  const arrow = (x1: number, y1: number, x2: number, y2: number, label?: string) => {
    ctx.strokeStyle = '#33414f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 14 * Math.cos(angle - 0.4), y2 - 14 * Math.sin(angle - 0.4));
    ctx.lineTo(x2 - 14 * Math.cos(angle + 0.4), y2 - 14 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = '#33414f';
    ctx.fill();
    if (label) {
      ctx.fillStyle = '#6b7a8c';
      ctx.font = `400 16px ${FONT_MONO}`;
      ctx.fillText(label, (x1 + x2) / 2 - ctx.measureText(label).width / 2, (y1 + y2) / 2 - 10);
    }
  };

  node(44, 128, 250, 88, 'Flutter client', 'iOS · Android · Web', '#dbeafe');
  node(392, 128, 250, 88, 'FastAPI gateway', 'authn · rate limit', '#dcfce7');
  node(738, 128, 242, 88, 'Token vault', 'OAuth2, edge only', '#fee2e2');

  arrow(294, 172, 388, 172, 'https');
  arrow(642, 172, 734, 172);

  node(392, 296, 250, 88, 'Spring Boot', 'domain services', '#dcfce7');
  arrow(517, 220, 517, 292);

  node(112, 296, 210, 88, 'Local inference', 'data never leaves', '#ede9fe');
  arrow(392, 340, 326, 340);

  node(716, 296, 264, 88, 'SMART on FHIR', 'Cerner · Mayo Platform', '#fef3c7');
  arrow(642, 340, 712, 340);

  ctx.fillStyle = '#4a5867';
  ctx.font = `400 19px ${FONT_UI}`;
  let y = 470;
  for (const rule of [
    'Every boundary gets a rate limit and a retry budget.',
    'Nothing touching a record moves without SMART on FHIR.',
    'Inference runs local wherever the data cannot leave.',
    'One hop per layer — no service calls a service calls a service.',
  ]) {
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(54, y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a5867';
    y = paragraph(ctx, rule, 74, y, W - 130, 30);
    y += 6;
  }

  // Faces +X on the left-hand wall, so V arrives pointing down.
  return finish(canvas, 'flip-v');
}

/** The sticky notes — short, handwritten-feeling, and actually readable. */
export function stickyTexture() {
  const W = 1024;
  const H = 512;
  // Filled with the board colour rather than left transparent: the material is
  // opaque, so an alpha background renders as black gaps between the notes.
  const { canvas, ctx } = surface(W, H, '#eef1f6');

  // Saturated, not pastel.
  //
  // These were the tints a design system reaches for on a white page, and on a
  // whiteboard at 13 cm they disappeared: pale yellow on white reads as nothing
  // at all from anywhere in the room. A real sticky note is a strong colour —
  // that is the entire point of the product — and it has to hold up against the
  // brightest surface in the room.
  const notes: Array<[string, string]> = [
    ['#f6c945', 'ship it, then measure it'],
    ['#5fd6a4', 'the constraint picks the stack'],
    ['#77b2f0', 'a number with no source is a guess'],
    ['#f28b8b', 'no fibre → no excuse'],
    ['#b9a3f0', 'read the RFC first'],
    ['#f6a45c', 'local-first, until proven otherwise'],
  ];

  // Each note fills its whole cell, square to the canvas.
  //
  // The tilt used to be painted here with `ctx.rotate`. It is geometry now —
  // `build_sticky_notes` gives each note its own angle and curls its bottom
  // edge off the board — so drawing a tilt as well would double it, and the
  // corners would be cut off by the cell the quad maps to.
  const cell = W / 3;
  const cellHeight = H / 2;
  notes.forEach(([colour, text], index) => {
    const x = (index % 3) * cell;
    const y = Math.floor(index / 3) * cellHeight;
    ctx.save();
    ctx.translate(x + cell / 2, y + cellHeight / 2);
    ctx.fillStyle = colour;
    ctx.fillRect(-cell / 2, -cellHeight / 2, cell, cellHeight);
    // A darker band down the bottom edge, where the note curls away from the
    // board and shades itself. The geometry does curl, but the lightmap cannot
    // resolve a 3 mm lift, so the shading that sells it has to be drawn.
    const shade = ctx.createLinearGradient(0, cellHeight / 2 - 46, 0, cellHeight / 2);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = shade;
    ctx.fillRect(-cell / 2, cellHeight / 2 - 46, cell, 46);
    ctx.fillStyle = '#2b2b31';
    ctx.font = `600 32px ${FONT_UI}`;
    ctx.textAlign = 'center';
    const words = text.split(' ');
    let line = '';
    let cursor = -30;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > 250 && line) {
        ctx.fillText(line, 0, cursor);
        cursor += 38;
        line = word;
      } else {
        line = candidate;
      }
    }
    ctx.fillText(line, 0, cursor);
    ctx.restore();
  });

  // Same wall and same quad rotation as the whiteboard.
  return finish(canvas, 'flip-v');
}

/**
 * The printed CV standing on the desk.
 *
 * Composed here rather than rasterised from `public/cv.pdf`: pulling in a PDF
 * renderer to draw one page would cost more than the whole room's JavaScript,
 * and the PDF would then be a second source of truth that could disagree with
 * `src/data` the moment either changed. This draws from the same arrays every
 * other surface reads, so the page on the desk cannot contradict the page the
 * download link hands over.
 *
 * A4 proportion, 1:√2. The page is modelled at 210 × 297 mm, and a canvas of
 * any other shape would stretch the type across it.
 */
/**
 * A framed award, printed on the certificate that carries it.
 *
 * The three frames on the wall were blank coloured rectangles: modelled, lit
 * and baked, saying nothing. They are the one place in the room where the work
 * has actually been recognised by somebody else, and they were the only surface
 * with nothing written on it.
 *
 * Set like a certificate rather than a poster. A rule, the issuer above the
 * title, the year set small, and a good deal of empty paper — the restraint is
 * the point. An award shouts by being on the wall at all; the printing does not
 * need to shout as well, and `scope` is stated plainly because a company award
 * won by a team is a different thing from one earned alone and it would be
 * cheap to blur them.
 */
export function certificateTexture(index: number) {
  const award = awards[index];
  const landscape = index > 0;
  const W = landscape ? 1024 : 800;
  const H = landscape ? 820 : 1024;
  const { canvas, ctx } = surface(W, H, '#f7f5f0');

  // A faint warm wash toward the edges, so the paper is not a flat fill.
  const wash = ctx.createRadialGradient(W / 2, H / 2, W * 0.1, W / 2, H / 2, W * 0.78);
  wash.addColorStop(0, 'rgba(255,255,255,0.9)');
  wash.addColorStop(1, 'rgba(226,216,198,0.55)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  if (!award) return finish(canvas, 'flip-v');

  const M = Math.round(W * 0.13);
  const INK = '#1b2028';
  const MUTED = '#6d6459';
  const GOLD = '#9a7b3f';

  // A double rule inset from the edge, the way a certificate is bordered.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(2, W / 340);
  ctx.strokeRect(M * 0.62, M * 0.62, W - M * 1.24, H - M * 1.24);
  ctx.lineWidth = 1;
  ctx.strokeRect(M * 0.62 + 9, M * 0.62 + 9, W - M * 1.24 - 18, H - M * 1.24 - 18);

  ctx.textAlign = 'center';
  const mid = W / 2;
  let y = Math.round(H * (landscape ? 0.26 : 0.24));

  ctx.fillStyle = MUTED;
  ctx.font = `600 ${Math.round(W * 0.026)}px ${FONT_UI}`;
  ctx.fillText(award.issuer.toUpperCase(), mid, y);

  y += Math.round(H * (landscape ? 0.115 : 0.1));
  ctx.fillStyle = INK;
  // Long titles wrap rather than shrink to nothing; two lines is the limit a
  // frame this size can hold at a readable weight.
  const size = award.title.length > 34 ? W * 0.052 : W * 0.064;
  ctx.font = `700 ${Math.round(size)}px ${FONT_UI}`;
  const words = award.title.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > W - M * 2 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  for (const text of lines.slice(0, 2)) {
    ctx.fillText(text, mid, y);
    y += Math.round(size * 1.24);
  }

  y += Math.round(H * 0.03);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(2, W / 420);
  ctx.beginPath();
  ctx.moveTo(mid - W * 0.11, y);
  ctx.lineTo(mid + W * 0.11, y);
  ctx.stroke();

  y += Math.round(H * 0.075);
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${Math.round(W * 0.028)}px ${FONT_UI}`;
  ctx.fillText(award.scope === 'team' ? `${award.year}  ·  team award` : award.year, mid, y);

  ctx.textAlign = 'left';
  return finish(canvas, 'flip-v');
}

export function cvTexture() {
  const W = 1024;
  const H = 1448;
  const { canvas, ctx } = surface(W, H, '#f6f7f9');

  const M = 74; // Page margin, roughly the 18 mm a printed CV would carry.
  const INK = '#141a22';
  const MUTED = '#5b6775';
  const RULE = '#c9d1db';

  const rule = (y: number) => {
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();
  };

  const heading = (text: string, y: number) => {
    ctx.fillStyle = '#2563eb';
    ctx.font = `700 21px ${FONT_UI}`;
    ctx.fillText(text.toUpperCase(), M, y);
    rule(y + 14);
    return y + 48;
  };

  ctx.fillStyle = INK;
  ctx.font = `700 54px ${FONT_UI}`;
  ctx.fillText(profile.name, M, M + 46);

  ctx.fillStyle = '#2563eb';
  ctx.font = `600 26px ${FONT_UI}`;
  ctx.fillText(profile.role, M, M + 84);

  ctx.fillStyle = MUTED;
  ctx.font = `400 20px ${FONT_UI}`;
  ctx.fillText(`${profile.email}  ·  ${profile.location} (${profile.timezone})`, M, M + 122);

  let y = heading('Profile', M + 190);
  ctx.fillStyle = '#3b4653';
  ctx.font = `400 21px ${FONT_UI}`;
  y = paragraph(ctx, profile.tagline, M, y, W - M * 2, 31) + 26;

  y = heading('Experience', y);
  // Four roles, not five. The fifth pushes the education block off the bottom
  // of the sheet, and a CV that runs off the page is worse than one that stops
  // — the panel behind this carries the full history either way.
  for (const role of experience.slice(0, 4)) {
    ctx.fillStyle = INK;
    ctx.font = `600 23px ${FONT_UI}`;
    ctx.fillText(`${role.role} — ${role.company}`, M, y);

    ctx.fillStyle = MUTED;
    ctx.font = `400 19px ${FONT_MONO}`;
    const period = role.period;
    ctx.fillText(period, W - M - ctx.measureText(period).width, y);

    y += 30;
    ctx.fillStyle = '#4a5867';
    ctx.font = `400 19px ${FONT_UI}`;
    y = paragraph(ctx, role.highlights[0] ?? role.description, M + 22, y, W - M * 2 - 22, 27) + 20;
  }

  y = heading('Stack', y + 4);
  ctx.fillStyle = '#4a5867';
  ctx.font = `400 20px ${FONT_UI}`;
  const core = skillGroups
    .flatMap((group) => group.skills)
    .filter((skill) => skill.level === 'core')
    .map((skill) => skill.name)
    .join(' · ');
  y = paragraph(ctx, core, M, y, W - M * 2, 29) + 26;

  y = heading('Education', y);
  const degree = education[0];
  if (degree) {
    ctx.fillStyle = INK;
    ctx.font = `600 23px ${FONT_UI}`;
    ctx.fillText(degree.degree, M, y);
    y += 30;
    ctx.fillStyle = MUTED;
    ctx.font = `400 19px ${FONT_UI}`;
    ctx.fillText(`${degree.institution} · ${degree.period} · ${degree.detail}`, M, y);
    y += 44;
  }

  // Recognition, in the third of the page that was empty.
  //
  // Set as plain lines rather than a feature: the year, the award, the issuer,
  // and nothing else. A CV that argues for itself is doing the reader's job for
  // them, and these are facts that hold up without help. Team awards say so —
  // borrowing a company's recognition is the fastest way to lose the benefit of
  // the ones earned alone.
  y = heading('Recognition', y);
  for (const award of awards) {
    ctx.fillStyle = INK;
    ctx.font = `600 21px ${FONT_UI}`;
    ctx.fillText(award.title, M, y);

    ctx.fillStyle = MUTED;
    ctx.font = `400 19px ${FONT_UI}`;
    ctx.textAlign = 'right';
    ctx.fillText(award.scope === 'team' ? `${award.year} · team` : award.year, W - M, y);
    ctx.textAlign = 'left';

    y += 26;
    ctx.fillStyle = '#7a8694';
    ctx.font = `400 18px ${FONT_UI}`;
    ctx.fillText(award.issuer, M + 22, y);
    y += 32;
  }

  // Footer rule and the fold line a printed sheet would show. Small, but the
  // difference between a page and a white rectangle with words on it.
  ctx.strokeStyle = '#e3e8ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H / 3);
  ctx.lineTo(W, H / 3);
  ctx.stroke();

  // Mirrored, like the monitors and the laptop. The page stands facing +Z in
  // glTF space along with them, so its quad samples U back to front and every
  // line of the CV would print in reverse. The whiteboard faces +X and is the
  // one readable surface here that does not need this.
  return finish(canvas, 'mirror-u');
}

/**
 * One book spine, carrying a project title.
 *
 * Drawn per book rather than as one strip across the shelf: the books are
 * separate solids with separate UVs, so a single shared image tiles across
 * every one of them instead of spanning the row. Each spine is its own quad in
 * the model with its own 0..1 UV, and gets its own small canvas here.
 */
export function bookSpineTexture(index: number) {
  const project = projects[index % Math.max(projects.length, 1)];
  const W = 192;
  const H = 768;

  // Ink-and-cloth tones, not web brand colours. The first palette was six
  // saturated UI hexes, and under the shelf's cyan wash the row rendered as
  // toy blocks — real publishers print spines in dyes that have some grey in
  // them, and that grey is what lets the titles read as objects.
  const palette = ['#31517f', '#5b4a78', '#3d6459', '#8a4f2d', '#7c3f55', '#33607f'];
  const base = palette[index % palette.length]!;
  const { canvas, ctx } = surface(W, H, base);

  // Head and tail bands, and a rule down the fore-edge: the small print
  // furniture that separates a book from a coloured block.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, W, 26);
  ctx.fillRect(0, H - 26, W, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(W - 10, 34, 3, H - 68);

  if (!project) return finish(canvas, 'flip-v');

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#f8fafc';
  let size = 52;
  ctx.font = `700 ${size}px ${FONT_UI}`;
  // Shrink to fit rather than truncate — a title ending in an ellipsis reads
  // as a bug on something the visitor is being invited to lean in and read.
  while (ctx.measureText(project.title).width > H - 120 && size > 22) {
    size -= 2;
    ctx.font = `700 ${size}px ${FONT_UI}`;
  }
  ctx.fillText(project.title, 0, -6);

  ctx.fillStyle = 'rgba(248,250,252,0.72)';
  ctx.font = `500 24px ${FONT_UI}`;
  const stack = project.tags.slice(0, 2).join(' · ');
  if (stack) ctx.fillText(stack, 0, 34);

  ctx.restore();
  // Same quad rotation as the whiteboard: standing up to face +X sends V
  // downward. Verified by `check_painted_uvs`, not by eye — spine text is far
  // too small to read upside-down from any camera the room has.
  return finish(canvas, 'flip-v');
}

/**
 * The keycap legends: one 15x6 atlas the whole keyboard addresses.
 *
 * `build_keyboard_and_props` puts a small quad on top of every cap and points
 * its UVs at cell (column, row) through `_cell_uvs`, so this canvas is a grid
 * and each cell is one key's face. Rows are the keyboard's rows top to bottom;
 * columns are position within the row. Rows are shorter than fifteen keys
 * wherever the row carries wide keys, and those trailing cells are simply never
 * sampled.
 *
 * Letters rather than a photograph of a keyboard, because a keyboard seen from
 * across a room is not read — it is *recognised*, and what makes it recognisable
 * is the shape of the block plus the fact that the caps carry marks at all. A
 * blank keyboard reads as a prop instantly; a legible one at this distance would
 * only be legible if the letters were far too big.
 *
 * Drawn as-is, with no mirroring. That is worth stating because it was got
 * wrong first time on an argument that sounded airtight — the quads face +Z
 * with U along world +X, the typist looks down -Y, and a cross product says
 * world +X lands on their left, so the legends should need flipping. They
 * render backwards when flipped. The argument is somewhere wrong and the
 * render is not, so this follows the render.
 *
 * A texture-level `mirror-u` would be the wrong tool regardless: negating U
 * across the whole atlas maps cell 0 to cell 14, so every key would show a
 * different key's letter. Anything an atlas needs has to happen inside a cell.
 */
const KEY_ROWS: readonly (readonly string[])[] = [
  ['esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', '⌦', '⏏'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '⌫'],
  ['⇥', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['⇪', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", '⏎'],
  ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', '⇧'],
  ['ctrl', '⌥', '⌘', '', '⌘', '⌥', 'fn', 'ctrl'],
];

export function keycapTexture() {
  const columns = 15;
  const rows = KEY_ROWS.length;
  const cell = { w: 128, h: 110 };

  // Transparent, so there is no background to match.
  //
  // It was painted the cap's own colour on the theory that an exact match would
  // vanish. It does not, and cannot: the quad is a different material from the
  // cap — its own roughness, no procedural grain, no aging masks — so matching
  // the base colour still leaves a rectangle that shades differently from the
  // key under it, and every cap in the room grew what looked like a sticker.
  //
  // Drawing only the mark and letting the cap show through removes the whole
  // class of mismatch rather than tuning it down. There is nothing to match
  // when there is nothing there.
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell.w * SCALE;
  canvas.height = rows * cell.h * SCALE;
  const ctx = canvas.getContext('2d')!;
  // Same contract as `surface`: cells are laid out in their own units and the
  // context does the scaling, so the grid maths below is untouched by SCALE.
  // Getting this wrong would not blur the legends — it would put every one of
  // them in the top-left quarter of the atlas, on the wrong key.
  ctx.scale(SCALE, SCALE);

  for (const [row, keys] of KEY_ROWS.entries()) {
    for (const [column, label] of keys.entries()) {
      if (!label) continue;

      const cx = (column + 0.5) * cell.w;
      const cy = (row + 0.5) * cell.h;

      ctx.save();
      ctx.translate(cx, cy);
      // Rotated half a turn, per cell.
      //
      // `_cell_uvs` already inverts V so that row 0 is the top row of the
      // image, and the quads address U along world +X while the typist reads
      // along -X. Those two together are a 180° turn, not a mirror, which is
      // worth distinguishing because the two look alike on letters and not at
      // all on digits: drawn straight, `9` came out as `6` and the brackets
      // swapped both their shapes and their places. A mirror does neither.
      //
      // Applied inside the cell rather than to the texture, because negating U
      // across a grid atlas maps cell 0 to cell 14 and every key would show a
      // different key's letter.
      ctx.scale(-1, -1);

      // Sub-pixel legends on modifiers, full size on the alphanumerics. A real
      // cap does the same thing for the same reason — "shift" does not fit at
      // the size "A" is set in.
      const long = label.length > 2;
      ctx.font = `${long ? 500 : 600} ${long ? 34 : 52}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Never white. Legends are printed or lasered on, and the mark takes the
      // room's light like the plastic around it — a pure white letter on a dim
      // keyboard is the one thing in the render that is brighter than the lamp.
      ctx.fillStyle = 'rgba(226,232,244,0.88)';
      ctx.fillText(label, 0, 2);
      ctx.restore();
    }
  }

  return finish(canvas);
}
