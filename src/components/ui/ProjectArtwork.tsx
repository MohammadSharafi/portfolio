import { useMemo } from 'react';
import type { ArtworkPattern } from '@/data/projects';

interface ProjectArtworkProps {
  pattern: ArtworkPattern;
  hue: number;
  seed: string;
  className?: string;
}

const WIDTH = 400;
const HEIGHT = 240;

/** Small deterministic PRNG so a given project always renders the same art. */
function createRandom(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function Nodes({ hue, seed }: { hue: number; seed: string }) {
  const { points, edges } = useMemo(() => {
    const random = createRandom(seed);
    const pts = Array.from({ length: 11 }, () => ({
      x: 30 + random() * (WIDTH - 60),
      y: 30 + random() * (HEIGHT - 60),
      r: 2.5 + random() * 3.5,
    }));

    const links: Array<[number, number]> = [];
    pts.forEach((a, i) => {
      const distances = pts
        .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((entry) => entry.j !== i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2);
      distances.forEach(({ j }) => {
        if (!links.some(([m, n]) => (m === i && n === j) || (m === j && n === i))) {
          links.push([i, j]);
        }
      });
    });

    return { points: pts, edges: links };
  }, [seed]);

  return (
    <g>
      {edges.map(([from, to]) => {
        const a = points[from];
        const b = points[to];
        if (!a || !b) return null;
        return (
          <line
            key={`${from}-${to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={`oklch(0.72 0.14 ${hue})`}
            strokeOpacity="0.4"
            strokeWidth="1"
          />
        );
      })}
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={point.r}
          fill={`oklch(0.78 0.16 ${hue + index * 4})`}
          fillOpacity="0.9"
        />
      ))}
    </g>
  );
}

function Waves({ hue, seed }: { hue: number; seed: string }) {
  const paths = useMemo(() => {
    const random = createRandom(seed);
    return Array.from({ length: 5 }, (_, index) => {
      const amplitude = 14 + random() * 20;
      const phase = random() * Math.PI * 2;
      const baseline = 55 + index * 32;
      const steps = 40;
      const d = Array.from({ length: steps + 1 }, (_, step) => {
        const x = (step / steps) * WIDTH;
        const y = baseline + Math.sin(phase + (step / steps) * Math.PI * 3) * amplitude;
        return `${step === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      return { d, opacity: 0.25 + index * 0.13 };
    });
  }, [seed]);

  return (
    <g fill="none" strokeWidth="2" strokeLinecap="round">
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          stroke={`oklch(0.75 0.15 ${hue + index * 8})`}
          strokeOpacity={path.opacity}
        />
      ))}
    </g>
  );
}

function Grid({ hue }: { hue: number }) {
  const columns = 12;
  const rows = 7;
  return (
    <g>
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => {
          const size = 3 + ((row * columns + column) % 4);
          return (
            <rect
              key={`${row}-${column}`}
              x={20 + column * 32}
              y={20 + row * 30}
              width={size * 2}
              height={size * 2}
              rx={2}
              fill={`oklch(0.76 0.14 ${hue + column * 3})`}
              fillOpacity={0.25 + ((row + column) % 5) * 0.15}
            />
          );
        })
      )}
    </g>
  );
}

function Orbit({ hue, seed }: { hue: number; seed: string }) {
  const satellites = useMemo(() => {
    const random = createRandom(seed);
    return Array.from({ length: 7 }, (_, index) => {
      const radius = 40 + index * 14;
      const angle = random() * Math.PI * 2;
      return {
        radius,
        cx: WIDTH / 2 + Math.cos(angle) * radius,
        cy: HEIGHT / 2 + Math.sin(angle) * radius * 0.62,
      };
    });
  }, [seed]);

  return (
    <g>
      {satellites.map((satellite, index) => (
        <ellipse
          key={`ring-${index}`}
          cx={WIDTH / 2}
          cy={HEIGHT / 2}
          rx={satellite.radius}
          ry={satellite.radius * 0.62}
          fill="none"
          stroke={`oklch(0.72 0.13 ${hue})`}
          strokeOpacity={0.35 - index * 0.03}
          strokeWidth="1"
        />
      ))}
      {satellites.map((satellite, index) => (
        <circle
          key={`dot-${index}`}
          cx={satellite.cx}
          cy={satellite.cy}
          r={3 + (index % 3)}
          fill={`oklch(0.8 0.16 ${hue + index * 6})`}
        />
      ))}
      <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="10" fill={`oklch(0.82 0.17 ${hue})`} />
    </g>
  );
}

function Stack({ hue }: { hue: number }) {
  return (
    <g>
      {Array.from({ length: 6 }, (_, index) => (
        <rect
          key={index}
          x={70 + index * 12}
          y={40 + index * 24}
          width={200}
          height={44}
          rx={8}
          fill={`oklch(0.74 0.15 ${hue + index * 7})`}
          fillOpacity={0.2 + index * 0.12}
        />
      ))}
    </g>
  );
}

/**
 * Generated cover art. Every project card used to load a remote stock photo that
 * had nothing to do with the code; this renders locally, scales cleanly and
 * stays visually consistent across the grid.
 */
export function ProjectArtwork({ pattern, hue, seed, className }: ProjectArtworkProps) {
  const gradientId = `artwork-gradient-${seed}`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      role="presentation"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`oklch(0.32 0.11 ${hue})`} />
          <stop offset="100%" stopColor={`oklch(0.22 0.08 ${hue + 40})`} />
        </linearGradient>
      </defs>

      <rect width={WIDTH} height={HEIGHT} fill={`url(#${gradientId})`} />

      {pattern === 'nodes' ? <Nodes hue={hue} seed={seed} /> : null}
      {pattern === 'waves' ? <Waves hue={hue} seed={seed} /> : null}
      {pattern === 'grid' ? <Grid hue={hue} /> : null}
      {pattern === 'orbit' ? <Orbit hue={hue} seed={seed} /> : null}
      {pattern === 'stack' ? <Stack hue={hue} /> : null}
    </svg>
  );
}
