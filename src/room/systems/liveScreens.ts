/**
 * The parts of the screens that move.
 *
 * A monitor showing one frozen frame is the tell that gives a rendered room
 * away fastest — a still image of a screen is a photograph of a screen, and the
 * eye knows the difference immediately. Rather than redraw a whole 1024×576
 * canvas every frame for the sake of a cursor, each screen declares small
 * rectangles that are allowed to change. Every tick refills a rectangle with the
 * flat colour it sits on and repaints only what is inside it.
 *
 * The regions are chosen to sit over solid background, so refilling is enough
 * to erase the previous frame and nothing underneath needs re-deriving.
 */

import type { Texture } from 'three';

const FONT_UI = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export type LiveRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The flat colour the region sits on, used to clear it each tick. */
  background: string;
  /** `t` is seconds since the room loaded. Coordinates are canvas-absolute. */
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
};

/** A 1 Hz square wave, for anything that blinks like a terminal caret. */
function blink(t: number) {
  return t % 1 < 0.55;
}

/**
 * The clinical dashboard: a link indicator that pulses, and a throughput
 * counter that keeps counting. Both are the sort of thing a connected clinical
 * tool genuinely does while you are not looking at it.
 */
const clinical: LiveRegion[] = [
  {
    x: 760,
    y: 12,
    w: 250,
    h: 34,
    background: '#111c2f',
    draw(ctx, t) {
      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3));
      ctx.fillStyle = `rgba(74, 222, 128, ${pulse.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(770, 24, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.font = `500 15px ${FONT_MONO}`;
      ctx.fillText('SMART on FHIR · connected', 784, 30);
    },
  },
  {
    x: 668,
    y: 500,
    w: 320,
    h: 40,
    background: '#0f1a2c',
    draw(ctx, t) {
      // Counts up, wraps, and never claims a total — it reads as a live meter
      // rather than as a figure about a real cohort.
      const value = 1240 + Math.floor((t * 7) % 460);
      ctx.fillStyle = '#7f92ad';
      ctx.font = `400 14px ${FONT_UI}`;
      ctx.fillText('requests / hr', 684, 522);
      ctx.fillStyle = '#8fd4ff';
      ctx.font = `600 22px ${FONT_MONO}`;
      ctx.fillText(String(value), 800, 524);
    },
  },
];

/**
 * The editor: a caret in the code, and a terminal that runs the verify script
 * on a loop. The output is the real gate list, so what it prints is what the
 * repository actually checks.
 */
const STEPS = ['format', 'lint', 'typecheck', 'test', 'build'];

const code: LiveRegion[] = [
  {
    // One line below the last line of code. The editor draws 13 lines from
    // y = 82 at 27 px apart, so line 14's baseline is 433 — put the caret on
    // line 13 and clearing the region takes the closing brace with it.
    x: 62,
    y: 415,
    w: 30,
    h: 24,
    background: '#0d1117',
    draw(ctx, t) {
      if (!blink(t)) return;
      ctx.fillStyle = '#58a6ff';
      ctx.fillRect(64, 417, 10, 19);
    },
  },
  {
    x: 0,
    y: 484,
    w: 1024,
    h: 92,
    background: '#161b22',
    draw(ctx, t) {
      // One cycle: type the command, then tick the gates off one per beat.
      const cycle = t % 12;
      const command = '$ npm run verify';
      const typed = cycle < 2 ? command.slice(0, Math.ceil((cycle / 2) * command.length)) : command;

      ctx.fillStyle = '#7d8590';
      ctx.font = `400 15px ${FONT_MONO}`;
      ctx.fillText(typed, 22, 514);

      if (cycle < 2) {
        if (blink(t)) {
          ctx.fillStyle = '#58a6ff';
          ctx.fillRect(24 + ctx.measureText(typed).width, 501, 9, 16);
        }
        return;
      }

      const done = Math.min(STEPS.length, Math.floor((cycle - 2) / 1.4));
      let x = 22;
      for (let i = 0; i < STEPS.length; i += 1) {
        const passed = i < done;
        ctx.fillStyle = passed ? '#3fb950' : '#484f58';
        ctx.fillText(passed ? '✓' : '·', x, 540);
        ctx.fillStyle = passed ? '#c9d1d9' : '#484f58';
        ctx.fillText(STEPS[i]!, x + 16, 540);
        x += 26 + ctx.measureText(STEPS[i]!).width;
      }

      if (done === STEPS.length) {
        ctx.fillStyle = '#3fb950';
        ctx.fillText('all gates green', 22, 564);
      } else if (blink(t)) {
        ctx.fillStyle = '#58a6ff';
        ctx.fillRect(24, 551, 9, 16);
      }
    },
  },
];

/**
 * The laptop terminal: a caret waiting at the prompt.
 *
 * The prompt's y is read off the texture rather than written down here. The
 * terminal grows from the top and its length depends on how many stats and
 * roles the CV carries, so a constant would drift the moment either changed —
 * and drift silently, because a caret blinking over blank canvas looks fine
 * until you notice the real one below it is frozen.
 */
function terminal(texture: Texture): LiveRegion[] {
  const promptY = typeof texture.userData['promptY'] === 'number' ? texture.userData['promptY'] : 0;
  if (!promptY) return [];

  return [
    {
      x: 24,
      y: promptY - 22,
      w: 200,
      h: 30,
      background: '#07090e',
      draw(ctx, t) {
        ctx.fillStyle = '#6ee7b7';
        ctx.font = `400 20px ${FONT_MONO}`;
        ctx.fillText('$', 30, promptY);
        if (blink(t)) ctx.fillRect(52, promptY - 15, 11, 19);
      },
    },
  ];
}

export const LIVE_REGIONS: Record<string, (texture: Texture) => LiveRegion[]> = {
  ix_monitor_health_display: () => clinical,
  ix_monitor_code_display: () => code,
  ix_laptop_display: terminal,
};
