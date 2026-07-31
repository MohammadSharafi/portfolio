import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { objectBounds } from './objectBounds';
import { framesSubject, resolveFraming, type Framing } from './framing';
import { boundsFor } from './framing';
import { objectIds, roomObjects, resolveStops } from './objects';

/**
 * The stale-bounds guard.
 *
 * `objectBounds.ts` is generated from `room.glb`, and a generated file that is
 * only regenerated when someone remembers is a hand-authored file with extra
 * steps. This re-parses the shipped GLB and fails if the committed numbers have
 * drifted — which is the exact failure that put three camera stops on empty
 * desk and left them there, looking like bad composition rather than a bug.
 *
 * The parsing is deliberately done here rather than through a glTF library:
 * the node hierarchy and accessor min/max are all this needs, and a loader
 * would pull a WebGL context into a jsdom test to read four numbers.
 */

const GLB = resolve(__dirname, '../../../public/models/room.glb');

type Matrix = number[];

function identity(): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Column-major 4x4 multiply, matching glTF's convention. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function compose(node: Record<string, unknown>): Matrix {
  if (Array.isArray(node.matrix)) return node.matrix as Matrix;
  const [tx, ty, tz] = (node.translation as number[]) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = (node.rotation as number[]) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (node.scale as number[]) ?? [1, 1, 1];

  const x2 = qx! + qx!;
  const y2 = qy! + qy!;
  const z2 = qz! + qz!;
  const xx = qx! * x2;
  const xy = qx! * y2;
  const xz = qx! * z2;
  const yy = qy! * y2;
  const yz = qy! * z2;
  const zz = qz! * z2;
  const wx = qw! * x2;
  const wy = qw! * y2;
  const wz = qw! * z2;

  return [
    (1 - (yy + zz)) * sx!,
    (xy + wz) * sx!,
    (xz - wy) * sx!,
    0,
    (xy - wz) * sy!,
    (1 - (xx + zz)) * sy!,
    (yz + wx) * sy!,
    0,
    (xz + wy) * sz!,
    (yz - wx) * sz!,
    (1 - (xx + yy)) * sz!,
    0,
    tx!,
    ty!,
    tz!,
    1,
  ];
}

/** Mirrors `toObjectId`, kept local so this test fails on real drift rather
 *  than agreeing with a bug in the mapper. */
function toId(name: string): string | null {
  if (!name.startsWith('ix_')) return null;
  const parts = name.slice(3).replace(/_\d+$/, '').split('_');
  for (let end = parts.length; end > 0; end -= 1) {
    const stem = parts.slice(0, end).join('-');
    if ((objectIds as readonly string[]).includes(stem)) return stem;
  }
  return null;
}

function measure(): Record<string, { min: number[]; max: number[] }> {
  const raw = readFileSync(GLB);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let offset = 12;
  let gltf: Record<string, never[]> | null = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      gltf = JSON.parse(
        new TextDecoder().decode(raw.subarray(offset + 8, offset + 8 + length))
      ) as Record<string, never[]>;
    }
    offset += 8 + length + (((-length % 4) + 4) % 4);
  }
  if (!gltf) throw new Error('no JSON chunk in room.glb');

  const nodes = (gltf.nodes ?? []) as unknown as Record<string, unknown>[];
  const meshes = (gltf.meshes ?? []) as unknown as Record<string, unknown>[];
  const accessors = (gltf.accessors ?? []) as unknown as Record<string, number[]>[];
  const boxes: Record<string, { min: number[]; max: number[] }> = {};

  const visit = (index: number, parent: Matrix): void => {
    const node = nodes[index]!;
    const world = multiply(parent, compose(node));
    const id = toId((node.name as string) ?? '');
    if (id !== null && node.mesh !== undefined) {
      const primitives = (meshes[node.mesh as number]!.primitives ?? []) as Record<
        string,
        Record<string, number>
      >[];
      for (const primitive of primitives) {
        const position = primitive.attributes?.POSITION;
        if (position === undefined) continue;
        const accessor = accessors[position]!;
        const low = accessor.min;
        const high = accessor.max;
        if (!low || !high) continue;
        const box = (boxes[id] ??= {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        });
        // Every corner: a rotated node's extremes are not the transforms of
        // its extremes.
        for (const cx of [low[0]!, high[0]!]) {
          for (const cy of [low[1]!, high[1]!]) {
            for (const cz of [low[2]!, high[2]!]) {
              const wx = world[0]! * cx + world[4]! * cy + world[8]! * cz + world[12]!;
              const wy = world[1]! * cx + world[5]! * cy + world[9]! * cz + world[13]!;
              const wz = world[2]! * cx + world[6]! * cy + world[10]! * cz + world[14]!;
              box.min = [
                Math.min(box.min[0]!, wx),
                Math.min(box.min[1]!, wy),
                Math.min(box.min[2]!, wz),
              ];
              box.max = [
                Math.max(box.max[0]!, wx),
                Math.max(box.max[1]!, wy),
                Math.max(box.max[2]!, wz),
              ];
            }
          }
        }
      }
    }
    for (const child of (node.children as number[]) ?? []) visit(child, world);
  };

  const scenes = gltf.scenes as unknown as Record<string, number[]>[];
  for (const root of scenes[(gltf.scene as unknown as number) ?? 0]!.nodes!) {
    visit(root, identity());
  }
  return boxes;
}

describe('objectBounds', () => {
  const measured = measure();

  it('covers every interactive object in the room', () => {
    for (const id of objectIds) {
      expect(measured, `${id} has no ix_ mesh in room.glb`).toHaveProperty(id);
    }
  });

  it.each(Object.keys(objectBounds))('matches what room.glb actually contains for %s', (id) => {
    const actual = measured[id];
    const committed = objectBounds[id as keyof typeof objectBounds];
    expect(actual, `${id} missing from the GLB`).toBeDefined();
    for (let axis = 0; axis < 3; axis += 1) {
      // A millimetre. Tighter would fail on the rounding in the generator;
      // looser would let a real move through.
      expect(actual!.min[axis]).toBeCloseTo(committed.min[axis]!, 3);
      expect(actual!.max[axis]).toBeCloseTo(committed.max[axis]!, 3);
    }
  });
});

describe('camera framing', () => {
  it('puts every stop outside the box it is framing', () => {
    // The failure this catches is a camera solved *inside* its subject, which
    // renders as the object's back faces filling the screen.
    for (const object of roomObjects) {
      const bounds = boundsFor(object.id, object.framing);
      const { position } = resolveFraming(object.framing, bounds, 1.6);
      const outside =
        position[0] < bounds.min[0] - 0.01 ||
        position[0] > bounds.max[0] + 0.01 ||
        position[1] < bounds.min[1] - 0.01 ||
        position[1] > bounds.max[1] + 0.01 ||
        position[2] < bounds.min[2] - 0.01 ||
        position[2] > bounds.max[2] + 0.01;
      expect(outside, `${object.id} camera is inside its own subject`).toBe(true);
    }
  });

  it.each([
    ['a desktop monitor', 1.78],
    ['a wide desktop', 2.4],
    ['a small laptop', 1.5],
    ['a tablet upright', 0.75],
    ['a phone upright', 0.46],
  ])('frames every subject completely on %s', (_label, aspect) => {
    // The bug that started this: three targets sat tens of centimetres off
    // their object, which reads as sloppy composition rather than as a fault.
    // "Near the object" is too weak a standard, though — a camera can point
    // straight at the whiteboard and still cut a third of it off the side. So
    // this asserts the real thing: every corner of the subject projects inside
    // the frustum, at every shape of viewport the site actually meets.
    for (const object of roomObjects) {
      const bounds = boundsFor(object.id, object.framing);
      expect(
        framesSubject(object.framing, bounds, aspect),
        `${object.id} is not wholly in frame at aspect ${aspect}`
      ).toBe(true);
    }
  });

  it('backs the camera off further on a narrow viewport than a wide one', () => {
    // One registry has to compose correctly on a desktop monitor and on a
    // phone held upright; the vertical field of view is fixed, so the only
    // way a wide subject fits a portrait screen is extra distance.
    const wide = resolveStops(1.9);
    const narrow = resolveStops(0.55);
    const board = roomObjects.find((entry) => entry.id === 'whiteboard')!;
    const bounds = boundsFor('whiteboard', board.framing);
    const span = (stop: { position: readonly number[] }) =>
      Math.hypot(
        stop.position[0]! - bounds.center[0],
        stop.position[1]! - bounds.center[1],
        stop.position[2]! - bounds.center[2]
      );
    expect(span(narrow.get('whiteboard')!)).toBeGreaterThan(span(wide.get('whiteboard')!));
  });

  it('never solves a stop below the floor', () => {
    for (const [id, stop] of resolveStops(1.6)) {
      expect(stop.position[1], `${id} camera is under the boards`).toBeGreaterThan(0.05);
    }
  });
});

describe('framing declarations', () => {
  it('gives every object a non-degenerate viewing direction', () => {
    for (const object of roomObjects) {
      const from = object.framing.from as Framing['from'];
      expect(
        Math.hypot(from[0], from[1], from[2]),
        `${object.id} has a zero direction`
      ).toBeGreaterThan(0.1);
    }
  });
});
