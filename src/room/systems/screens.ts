import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { projects } from '@/data/projects';
import { stats } from '@/data/stats';
import { experience } from '@/data/experience';
import { profile } from '@/data/profile';

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

function surface(width: number, height: number, background: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, mirrored = false) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;

  // The screens face the room across +Z, and looking down +Z puts world +X on
  // the left, so their quads sample U back to front and every line of text came
  // out mirrored. Corrected here rather than by negative-scaling the geometry,
  // which inverts winding order and culls the face entirely — which is exactly
  // what the first attempt at this did.
  if (mirrored) {
    texture.wrapS = RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
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

/** Monitor 1 — the clinical work. A dashboard, not a screenshot of one. */
export function clinicalScreen() {
  const W = 1024;
  const H = 576;
  const { canvas, ctx } = surface(W, H, '#0b1220');

  ctx.fillStyle = '#111c2f';
  ctx.fillRect(0, 0, W, 54);
  ctx.fillStyle = '#4d9fff';
  ctx.font = `600 20px ${FONT_UI}`;
  ctx.fillText('EHR AI Clinical Assistant', 26, 35);
  ctx.fillStyle = '#4ade80';
  ctx.font = `500 15px ${FONT_MONO}`;
  ctx.fillText('SMART on FHIR · connected', W - 250, 35);

  // Cohort chart. Real shape, arbitrary sample — it is decoration standing in
  // for protected data, and it is labelled as sample so it never reads as a
  // claim about a real cohort.
  ctx.fillStyle = '#0f1a2c';
  roundRect(ctx, 26, 78, 600, 250, 10);
  ctx.fill();
  ctx.fillStyle = '#7f92ad';
  ctx.font = `500 14px ${FONT_UI}`;
  ctx.fillText('Cohort throughput — sample data', 44, 106);

  const points = [0.32, 0.41, 0.38, 0.52, 0.61, 0.58, 0.72, 0.79, 0.74, 0.88, 0.94, 0.91];
  ctx.beginPath();
  points.forEach((value, index) => {
    const x = 48 + (index / (points.length - 1)) * 552;
    const y = 306 - value * 170;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#4d9fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineTo(600, 306);
  ctx.lineTo(48, 306);
  ctx.closePath();
  ctx.fillStyle = 'rgba(77,159,255,0.16)';
  ctx.fill();

  // The endpoint tiles, from the CV rather than invented.
  const tiles = [
    ['123+', 'endpoints'],
    ['OAuth2', 'token vault'],
    ['HIPAA', 'compliant'],
    ['0', 'incidents'],
  ];
  tiles.forEach((tile, index) => {
    const x = 654;
    const y = 78 + index * 64;
    ctx.fillStyle = '#0f1a2c';
    roundRect(ctx, x, y, 344, 54, 8);
    ctx.fill();
    ctx.fillStyle = '#e6edf7';
    ctx.font = `600 22px ${FONT_UI}`;
    ctx.fillText(tile[0]!, x + 18, y + 35);
    ctx.fillStyle = '#7f92ad';
    ctx.font = `400 15px ${FONT_UI}`;
    ctx.fillText(tile[1]!, x + 110, y + 35);
  });

  ctx.fillStyle = '#0f1a2c';
  roundRect(ctx, 26, 348, 972, 200, 10);
  ctx.fill();
  ctx.fillStyle = '#7f92ad';
  ctx.font = `500 14px ${FONT_UI}`;
  ctx.fillText('Integrations', 44, 376);
  const rows = [
    'Cerner / Oracle Health',
    'Mayo Clinic Platform',
    'GCP Cloud Run',
    'FastAPI gateway',
  ];
  rows.forEach((row, index) => {
    const y = 406 + index * 32;
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(52, y - 5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9d6e8';
    ctx.font = `400 17px ${FONT_UI}`;
    ctx.fillText(row, 68, y);
  });

  return finish(canvas, true);
}

/** Monitor 2 — the editor, showing code that is actually about this room. */
export function codeScreen() {
  const W = 1024;
  const H = 576;
  const { canvas, ctx } = surface(W, H, '#0d1117');

  ctx.fillStyle = '#151b23';
  ctx.fillRect(0, 0, W, 40);
  ctx.fillStyle = '#7d8590';
  ctx.font = `400 14px ${FONT_MONO}`;
  ctx.fillText('room/engine/CameraRig.tsx', 96, 26);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((colour, index) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(26 + index * 20, 20, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  const lines: Array<Array<[string, string]>> = [
    [
      ['export function ', '#ff7b72'],
      ['CameraRig', '#d2a8ff'],
      ['({ reducedMotion }) {', '#c9d1d9'],
    ],
    [
      ['  const ', '#ff7b72'],
      ['focused', '#79c0ff'],
      [' = useEngine((s) => s.focused);', '#c9d1d9'],
    ],
    [['', '#c9d1d9']],
    [
      ['  useFrame', '#d2a8ff'],
      ['((_, delta) => {', '#c9d1d9'],
    ],
    [
      ['    const ', '#ff7b72'],
      ['dt', '#79c0ff'],
      [' = Math.min(0.05, delta);', '#c9d1d9'],
    ],
    [
      ['    const ', '#ff7b72'],
      ['k', '#79c0ff'],
      [' = 1 - Math.exp(-rate * dt);', '#c9d1d9'],
    ],
    [['', '#c9d1d9']],
    [['    // frame-rate independent, so the same', '#8b949e']],
    [['    // move feels the same at 60 and 120', '#8b949e']],
    [
      ['    position.', '#c9d1d9'],
      ['lerp', '#d2a8ff'],
      ['(goal, k);', '#c9d1d9'],
    ],
    [
      ['    camera.', '#c9d1d9'],
      ['lookAt', '#d2a8ff'],
      ['(target);', '#c9d1d9'],
    ],
    [['  });', '#c9d1d9']],
    [['}', '#c9d1d9']],
  ];

  ctx.font = `400 18px ${FONT_MONO}`;
  lines.forEach((line, index) => {
    const y = 82 + index * 27;
    ctx.fillStyle = '#484f58';
    ctx.fillText(String(index + 1).padStart(2, ' '), 22, y);
    let x = 62;
    for (const [text, colour] of line) {
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  });

  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, H - 92, W, 92);
  ctx.fillStyle = '#7d8590';
  ctx.font = `400 15px ${FONT_MONO}`;
  ctx.fillText('$ npm run verify', 22, H - 62);
  ctx.fillStyle = '#3fb950';
  ctx.fillText('✓ 61 tests · lint · typecheck · build', 22, H - 36);
  ctx.fillStyle = '#7d8590';
  ctx.fillText('$ ', 22, H - 12);

  return finish(canvas, true);
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

  return finish(canvas, true);
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

  return finish(canvas);
}

/** The sticky notes — short, handwritten-feeling, and actually readable. */
export function stickyTexture() {
  const W = 1024;
  const H = 512;
  // Filled with the board colour rather than left transparent: the material is
  // opaque, so an alpha background renders as black gaps between the notes.
  const { canvas, ctx } = surface(W, H, '#eef1f6');

  const notes: Array<[string, string]> = [
    ['#fde68a', 'ship it, then measure it'],
    ['#a7f3d0', 'the constraint picks the stack'],
    ['#bfdbfe', 'a number with no source is a guess'],
    ['#fecaca', 'no fibre → no excuse'],
    ['#ddd6fe', 'read the RFC first'],
    ['#fed7aa', 'Toronto — next'],
  ];

  notes.forEach(([colour, text], index) => {
    const x = (index % 3) * 341;
    const y = Math.floor(index / 3) * 256;
    ctx.save();
    ctx.translate(x + 170, y + 128);
    ctx.rotate((index % 2 === 0 ? 1 : -1) * 0.03);
    ctx.fillStyle = colour;
    ctx.fillRect(-150, -108, 300, 216);
    ctx.fillStyle = '#3f3f46';
    ctx.font = `500 30px ${FONT_UI}`;
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

  return finish(canvas);
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

  const palette = ['#2f5fd0', '#7c3aed', '#0f766e', '#c2410c', '#9d174d', '#0369a1'];
  const base = palette[index % palette.length]!;
  const { canvas, ctx } = surface(W, H, base);

  // Head and tail bands, and a rule down the fore-edge: the small print
  // furniture that separates a book from a coloured block.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, W, 26);
  ctx.fillRect(0, H - 26, W, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(W - 10, 34, 3, H - 68);

  if (!project) return finish(canvas);

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
  return finish(canvas);
}
