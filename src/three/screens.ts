import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';

const W = 1024;
const H = 640;

function createCanvas(width = W, height = H) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function windowChrome(ctx: CanvasRenderingContext2D, title: string, bg: string) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, W, 56);

  const dots = ['#ff5f57', '#febc2e', '#28c840'];
  dots.forEach((color, index) => {
    ctx.beginPath();
    ctx.arc(34 + index * 30, 28, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '500 22px ui-monospace, monospace';
  ctx.fillText(title, 150, 36);
}

/** Left monitor: the Dart snippet, syntax coloured. */
export function codeScreen(): Texture {
  const { canvas, ctx } = createCanvas();
  windowChrome(ctx, 'engineer.dart', '#0f1420');

  const line = (y: number, tokens: Array<[string, string]>) => {
    let x = 44;
    ctx.font = '400 25px ui-monospace, "SF Mono", monospace';
    for (const [text, color] of tokens) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    }
  };

  const KEY = '#c792ea';
  const STR = '#7ee787';
  const TYP = '#79c0ff';
  const TXT = '#c9d1d9';
  const DIM = '#6b7689';

  let y = 110;
  const step = 40;
  line(y, [
    ['class ', KEY],
    ['Engineer ', TXT],
    ['extends ', KEY],
    ['Human {', TXT],
  ]);
  line((y += step), [
    ['  final ', KEY],
    ['domain = ', TXT],
    ["'digital health'", STR],
    [';', TXT],
  ]);
  line((y += step), [
    ['  final ', KEY],
    ['stack = [', TXT],
    ["'Flutter'", STR],
    [', ', TXT],
    ["'Python'", STR],
    ['];', TXT],
  ]);
  y += step * 0.5;
  line((y += step), [['  @override', DIM]]);
  line((y += step), [
    ['  Future', TYP],
    ['<', TXT],
    ['Product', TYP],
    ['> ', TXT],
    ['build', TXT],
    ['(Problem p) ', TXT],
    ['async ', KEY],
    ['{', TXT],
  ]);
  line((y += step), [
    ['    await ', KEY],
    ['understand(p);', TXT],
  ]);
  line((y += step), [
    ['    return ', KEY],
    ['ship(measure: ', TXT],
    ['true', TYP],
    [');', TXT],
  ]);
  line((y += step), [['  }', TXT]]);
  line((y += step), [['}', TXT]]);

  // Caret
  ctx.fillStyle = '#4d7cff';
  ctx.fillRect(44, y + 18, 14, 30);

  return toTexture(canvas);
}

/** Centre monitor: the project grid. */
export function projectsScreen(titles: readonly string[]): Texture {
  const { canvas, ctx } = createCanvas();
  windowChrome(ctx, 'projects — portfolio', '#0d1119');

  ctx.fillStyle = '#e6edf7';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText('Selected work', 44, 130);

  ctx.fillStyle = '#6b7689';
  ctx.font = '400 22px system-ui, sans-serif';
  ctx.fillText('Distributed systems, local AI, mobile clients', 44, 168);

  const cardW = 296;
  const cardH = 128;
  const gap = 20;

  titles.slice(0, 6).forEach((title, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 44 + col * (cardW + gap);
    const y = 210 + row * (cardH + gap);

    const grad = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
    grad.addColorStop(0, index % 2 ? '#2b2450' : '#16305e');
    grad.addColorStop(1, index % 2 ? '#3c2a63' : '#1d4472');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 16);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#e6edf7';
    ctx.font = '600 24px system-ui, sans-serif';
    const words = title.split(' ');
    let lineText = '';
    let ty = y + 48;
    for (const word of words) {
      const next = lineText ? `${lineText} ${word}` : word;
      if (ctx.measureText(next).width > cardW - 40) {
        ctx.fillText(lineText, x + 20, ty);
        lineText = word;
        ty += 30;
      } else {
        lineText = next;
      }
    }
    ctx.fillText(lineText, x + 20, ty);

    ctx.fillStyle = '#7fa9ff';
    ctx.font = '400 19px ui-monospace, monospace';
    ctx.fillText('view source →', x + 20, y + cardH - 20);
  });

  return toTexture(canvas);
}

/** Right monitor (portrait): terminal with the real metrics. */
export function terminalScreen(lines: readonly string[]): Texture {
  const { canvas, ctx } = createCanvas(640, 1024);
  ctx.fillStyle = '#0a0e15';
  ctx.fillRect(0, 0, 640, 1024);

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, 640, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '500 20px ui-monospace, monospace';
  ctx.fillText('~/portfolio — zsh', 24, 32);

  ctx.font = '400 22px ui-monospace, monospace';
  let y = 100;
  for (const raw of lines) {
    if (raw.startsWith('$')) {
      ctx.fillStyle = '#7ee787';
      ctx.fillText('$', 24, y);
      ctx.fillStyle = '#c9d1d9';
      ctx.fillText(raw.slice(1).trim(), 48, y);
    } else if (raw.startsWith('✓')) {
      ctx.fillStyle = '#3fb950';
      ctx.fillText(raw, 24, y);
    } else if (raw === '') {
      // spacer
    } else {
      ctx.fillStyle = '#6b7689';
      ctx.fillText(raw, 24, y);
    }
    y += 34;
  }

  ctx.fillStyle = '#4d7cff';
  ctx.fillRect(24, y - 20, 12, 24);

  return toTexture(canvas);
}
