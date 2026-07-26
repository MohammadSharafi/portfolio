import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { journeyPalette as jp, skies } from './palette';
import { box, copy, glow, seeded, slab, standard, type Vec3 } from './primitives';

export interface View {
  position: Vec3;
  target: Vec3;
}

/**
 * A chapter's complete look: geometry, where the camera stands, and the
 * lighting the renderer eases toward while it is on screen. Keeping the light
 * rig in the stage rather than in the scene is what lets six very different
 * places share three lights between them — a budget a phone can actually run,
 * where a light per chapter would mean twenty and a shader recompile at every
 * transition. Every small warm source — a window, a bulb, a lit office floor —
 * is an emissive material picked up by the bloom pass instead.
 */
export interface Stage {
  root: Group;
  view: View;
  sky: Color;
  fog: [near: number, far: number];
  ambient: { color: Color; intensity: number };
  sun: { color: Color; intensity: number; position: Vec3 };
  accent: { color: Color; intensity: number; distance: number; position: Vec3 };
  /** Star dome opacity, 0 when the sky is too bright to show them. */
  stars: number;
  tick?: (t: number) => void;
}

/**
 * Chapters are laid out along +X and the camera drives toward the origin, so
 * scrolling forward is literally travelling toward the present. The room is
 * already built at the origin with its walls on the -X and -Z sides, which
 * means the final approach comes in through its open corner and never has to
 * clip through a wall.
 */
/**
 * Far enough apart that no chapter's geometry stands inside the next one's.
 * At eighteen the widest stages — Tehran's block grid and the crossing's
 * waterfront, each roughly twenty-six units across — overlapped their
 * neighbours, and the university courtyard rendered with a row of Tehran tower
 * blocks standing in it. Fog hides the gap between chapters; it cannot hide a
 * skyline that is genuinely in the room.
 */
export const STAGE_SPACING = 32;

export const anchors = {
  village: 5 * STAGE_SPACING,
  exam: 4 * STAGE_SPACING,
  university: 3 * STAGE_SPACING,
  city: 2 * STAGE_SPACING,
  crossing: 1 * STAGE_SPACING,
} as const;

/** Shifts a stage-local coordinate into world space. */
const at = (anchor: number, [x, y, z]: Vec3): Vec3 => [x + anchor, y, z];

const view = (anchor: number, position: Vec3, target: Vec3): View => ({
  position: at(anchor, position),
  target: at(anchor, target),
});

/**
 * Stage grounds overlap slightly so the camera never travels over a seam of
 * void between chapters. Each sits two millimetres above the last, which is
 * invisible at any camera distance in this scene and cheaper than clipping the
 * overlap properly.
 */
function ground(width: number, depth: number, material: MeshStandardMaterial, layer: number) {
  const mesh = new Mesh(new PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = layer * 0.002;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Chapter 01 — the village
// ---------------------------------------------------------------------------

function buildVillage(): Stage {
  const root = new Group();
  root.position.x = anchors.village;
  const random = seeded(20031);

  root.add(ground(24, 48, standard(jp.earth, { roughness: 1 }), 5));

  // The path runs the length of the chapter and out the far end — the road the
  // whole journey is on, seen from its beginning.
  const path = new Mesh(new PlaneGeometry(2.6, 48), standard(jp.earthPath, { roughness: 1 }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(1.5, 0.014, 0);
  root.add(path);

  // A ridge far enough back that the fog does most of the work on it.
  const ridgeMat = standard(jp.ridge, { roughness: 1 });
  for (let i = 0; i < 10; i += 1) {
    const height = 5 + random() * 7;
    const peak = new Mesh(new ConeGeometry(4 + random() * 3.5, height, 5, 1), ridgeMat);
    peak.position.set(-16 + i * 3.6 + random() * 1.6, height / 2 - 1.4, -20 - random() * 5);
    peak.rotation.y = random() * Math.PI;
    root.add(peak);
  }

  // Low hills nearer in, so the horizon is not one flat band.
  const hillMat = standard(jp.hill, { roughness: 1 });
  const hillGeometry = new IcosahedronGeometry(3.4, 1);
  for (let i = 0; i < 5; i += 1) {
    const hill = copy(hillGeometry, hillMat, [-11 + i * 5.6, -2.4 - random(), -12 - random() * 3]);
    hill.scale.set(1.7, 0.5, 1.2);
    root.add(hill);
  }

  // Flat-roofed mud brick with a parapet, the way a village on the Iranian
  // plateau actually looks — not the pitched-roof cottage a generator reaches
  // for by default.
  const wallMats = [
    standard(jp.mudBrick, { roughness: 1 }),
    standard(jp.mudBrickAlt, { roughness: 1 }),
  ];
  const roofMat = standard(jp.roofTile, { roughness: 1 });
  const litPane = glow(jp.window, 2.2);
  const darkPane = standard(jp.window, {
    roughness: 0.6,
    emissive: jp.window,
    emissiveIntensity: 0.22,
  });
  const paneGeometry = new PlaneGeometry(0.44, 0.58);

  const houses: Array<{
    x: number;
    z: number;
    w: number;
    h: number;
    d: number;
    r: number;
    lit: boolean;
  }> = [
    { x: -5.2, z: -2.4, w: 3.2, h: 2.4, d: 2.8, r: 0.12, lit: false },
    { x: -2.4, z: -6.6, w: 2.6, h: 2.0, d: 2.4, r: -0.3, lit: false },
    { x: -7.6, z: -7.8, w: 3.6, h: 2.9, d: 3.0, r: 0.24, lit: false },
    { x: -3.2, z: 1.6, w: 2.8, h: 2.2, d: 2.6, r: -0.1, lit: true },
    { x: -8.6, z: 2.8, w: 3.0, h: 2.1, d: 2.6, r: 0.4, lit: false },
    { x: 5.0, z: -5.6, w: 3.0, h: 2.3, d: 2.8, r: -0.18, lit: false },
    { x: 6.2, z: 2.4, w: 2.4, h: 1.9, d: 2.4, r: 0.32, lit: false },
    { x: -11.4, z: -3.2, w: 2.8, h: 2.2, d: 2.6, r: 0.08, lit: false },
  ];

  houses.forEach((house, index) => {
    const wallMat = wallMats[index % 2]!;
    root.add(slab([house.w, house.h, house.d], [house.x, house.h / 2, house.z], wallMat, house.r));
    root.add(
      slab(
        [house.w + 0.18, 0.2, house.d + 0.18],
        [house.x, house.h + 0.09, house.z],
        roofMat,
        house.r
      )
    );

    // Windows on the face pointing back up the path, toward the camera.
    const count = house.lit ? 2 : 1;
    for (let w = 0; w < count; w += 1) {
      const offset = count === 1 ? 0 : w * 0.86 - 0.43;
      const pane = new Mesh(paneGeometry, house.lit ? litPane : darkPane);
      pane.position.set(
        house.x + Math.cos(house.r) * offset + Math.sin(house.r) * (house.d / 2 + 0.02),
        house.h * 0.55,
        house.z - Math.sin(house.r) * offset + Math.cos(house.r) * (house.d / 2 + 0.02)
      );
      pane.rotation.y = house.r;
      root.add(pane);
    }
  });

  // One tree by the path. The village is sparse on purpose.
  const trunk = new Mesh(
    new CylinderGeometry(0.11, 0.18, 2.4, 7),
    standard(jp.bark, { roughness: 1 })
  );
  trunk.position.set(-0.7, 1.2, 5.2);
  root.add(trunk);

  const canopyMat = standard(jp.foliage, { roughness: 1 });
  const canopyGeometry = new IcosahedronGeometry(0.95, 0);
  const canopy: Vec3[] = [
    [-0.7, 2.6, 5.2],
    [-0.2, 2.95, 4.95],
    [-1.15, 3.0, 5.45],
    [-0.65, 3.45, 5.3],
  ];
  for (const position of canopy) {
    const blob = copy(canopyGeometry, canopyMat, position, random() * Math.PI);
    blob.scale.set(1, 0.78, 1);
    root.add(blob);
  }

  const moon = new Mesh(new SphereGeometry(1.25, 24, 18), glow(jp.moon, 1.5, { fogged: false }));
  moon.position.set(-6.5, 9.5, -21);
  root.add(moon);

  return {
    root,
    view: view(anchors.village, [9.0, 1.5, 6.4], [-2.0, 2.6, -9.0]),
    sky: skies.village,
    fog: [9, 36],
    ambient: { color: new Color('#4b5c84'), intensity: 1.25 },
    sun: { color: new Color('#8fa8dd'), intensity: 1.9, position: [-8, 10, -20] },
    // The one lit window: the only warm thing in the chapter, so the eye goes
    // straight to it. That is the entire frame.
    accent: {
      color: jp.window,
      intensity: 5.5,
      distance: 5.5,
      position: at(anchors.village, [-3.2, 1.3, 3.2]),
    },
    stars: 1,
  };
}

// ---------------------------------------------------------------------------
// Chapter 02 — the exam years
// ---------------------------------------------------------------------------

function buildExam(): Stage {
  const root = new Group();
  root.position.x = anchors.exam;

  root.add(ground(24, 40, standard(jp.courtyard, { roughness: 1 }), 4));

  // A courtyard corner: two walls, a blackboard, and one desk under one bulb.
  const wallMat = standard(jp.courtyard, { roughness: 0.98 });
  root.add(slab([16, 6, 0.3], [-1.5, 3, -4.2], wallMat));
  root.add(slab([0.3, 6, 12], [-9.4, 3, 1.8], wallMat));

  const boardMat = standard(jp.chalkboard, { roughness: 0.95 });
  root.add(slab([4.6, 2.4, 0.12], [-1.6, 2.3, -4.0], boardMat));

  // Chalk: enough marks to read as writing at this distance, no more.
  const chalkMat = standard(jp.chalk, {
    roughness: 0.9,
    emissive: jp.chalk,
    emissiveIntensity: 0.12,
  });
  const chalkRandom = seeded(881);
  for (let row = 0; row < 6; row += 1) {
    let x = -3.6;
    while (x < 0.2) {
      const width = 0.18 + chalkRandom() * 0.5;
      root.add(slab([width, 0.035, 0.02], [x + width / 2, 3.15 - row * 0.32, -3.93], chalkMat));
      x += width + 0.1 + chalkRandom() * 0.14;
    }
  }

  // Desk, chair, and the stack of books that is the point of the chapter.
  const woodMat = standard(jp.mudBrick, { roughness: 0.7 });
  const legMat = standard(jp.bark, { roughness: 0.6, metalness: 0.2 });
  root.add(box([1.9, 0.07, 0.95], [0, 0.76, -0.4], woodMat));
  for (const [lx, lz] of [
    [-0.85, -0.78],
    [0.85, -0.78],
    [-0.85, -0.02],
    [0.85, -0.02],
  ] as Array<[number, number]>) {
    root.add(box([0.07, 0.76, 0.07], [lx, 0.38, lz], legMat));
  }
  root.add(box([0.52, 0.06, 0.5], [0.1, 0.44, 0.62], woodMat));
  root.add(box([0.5, 0.6, 0.06], [0.1, 0.74, 0.86], woodMat));
  for (const [lx, lz] of [
    [-0.13, 0.4],
    [0.33, 0.4],
    [-0.13, 0.84],
    [0.33, 0.84],
  ] as Array<[number, number]>) {
    root.add(box([0.05, 0.44, 0.05], [lx, 0.22, lz], legMat));
  }

  const bookColours = [jp.tilework, jp.tileworkAlt, jp.roofTile, jp.cypress, jp.mudBrickAlt];
  let stackY = 0.8;
  for (let i = 0; i < 7; i += 1) {
    const colour = bookColours[i % bookColours.length]!;
    const thickness = 0.05 + (i % 3) * 0.016;
    root.add(
      box(
        [0.34, thickness, 0.24],
        [-0.62, stackY + thickness / 2, -0.42],
        standard(colour, { roughness: 0.85 }),
        (i % 2 === 0 ? 1 : -1) * (0.03 + (i % 3) * 0.02)
      )
    );
    stackY += thickness;
  }

  // An open notebook: two leaves tented slightly apart.
  const paperMat = standard(jp.chalk, { roughness: 0.95 });
  for (const sign of [-1, 1]) {
    const leaf = box([0.3, 0.008, 0.4], [0.16 + sign * 0.15, 0.8, -0.36], paperMat);
    leaf.rotation.z = sign * 0.06;
    root.add(leaf);
  }

  // A bare bulb on a flex. Everything in the frame is lit by this one thing.
  const flex = new Mesh(
    new CylinderGeometry(0.008, 0.008, 2.2, 6),
    standard(jp.bark, { roughness: 0.8 })
  );
  flex.position.set(0.05, 3.1, -0.5);
  root.add(flex);
  const bulb = new Mesh(new SphereGeometry(0.09, 16, 12), glow(jp.bulb, 5));
  bulb.position.set(0.05, 1.94, -0.5);
  root.add(bulb);

  return {
    root,
    view: view(anchors.exam, [2.6, 1.45, 3.1], [-0.15, 0.95, -0.5]),
    sky: skies.exam,
    fog: [7, 28],
    ambient: { color: new Color('#3c4a72'), intensity: 0.9 },
    sun: { color: new Color('#7f93c4'), intensity: 0.85, position: [-8, 11, 6] },
    accent: {
      color: jp.bulb,
      intensity: 15,
      distance: 9,
      position: at(anchors.exam, [0.05, 1.9, -0.5]),
    },
    stars: 0.7,
  };
}

// ---------------------------------------------------------------------------
// Chapter 03 — Isfahan University of Technology
// ---------------------------------------------------------------------------

/**
 * A two-centred pointed arch cut out of a solid bay. Building it as a hole in a
 * wall rather than as an arch on two piers gives the spandrel above the opening
 * for free, which is the part that actually makes an arcade read as Persian
 * rather than as a row of croquet hoops.
 */
function archBayGeometry() {
  const shape = new Shape();
  shape.moveTo(-1.5, 0);
  shape.lineTo(1.5, 0);
  shape.lineTo(1.5, 4.1);
  shape.lineTo(-1.5, 4.1);
  shape.lineTo(-1.5, 0);

  // The opening takes most of the bay's height. Left with a tall band of blank
  // wall above it, each bay reads as a slab with a slot in it rather than as
  // an arch.
  const opening = new Shape();
  opening.moveTo(-0.92, 0);
  opening.lineTo(-0.92, 2.1);
  opening.quadraticCurveTo(-0.92, 3.35, 0, 3.66);
  opening.quadraticCurveTo(0.92, 3.35, 0.92, 2.1);
  opening.lineTo(0.92, 0);
  opening.lineTo(-0.92, 0);
  shape.holes.push(opening);

  return new ExtrudeGeometry(shape, {
    depth: 0.55,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
}

function buildUniversity(): Stage {
  const root = new Group();
  root.position.x = anchors.university;

  root.add(ground(24, 44, standard(jp.sandstoneDeep, { roughness: 1 }), 3));

  const bayGeometry = archBayGeometry();
  const stoneMat = standard(jp.sandstone, { roughness: 0.9 });
  const stoneDeepMat = standard(jp.sandstoneDeep, { roughness: 0.95 });

  // Two arcades facing each other across a courtyard, receding into fog.
  //
  // The lit panel behind each opening is the whole trick. An unlit arcade at
  // night is a dark wall with slightly darker holes in it and reads as nothing
  // at all; light the space *behind* the arches and the arcade becomes a row of
  // glowing openings receding into the dark — which is both what the place
  // actually looks like and the same motif as the one lit window in the
  // village, repeated fourteen times.
  const litBay = new PlaneGeometry(1.9, 3.7);
  const litBayMat = glow(jp.window, 0.85);
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < 7; bay += 1) {
      const z = 4.5 - bay * 3.02;
      const mesh = copy(bayGeometry, stoneMat, [side * 5.4, 0, z], Math.PI / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);

      const panel = new Mesh(litBay, litBayMat);
      panel.position.set(side * 5.95, 1.85, z);
      panel.rotation.y = (side * Math.PI) / 2;
      root.add(panel);

      // The back wall of the arcade, so the lit panel is a recess rather than a
      // hole through to the chapter behind.
      root.add(slab([0.2, 4.1, 3.04], [side * 6.15, 2.05, z], stoneDeepMat));
    }
  }

  // A continuous cornice capping both arcades. As one run it reads as the top
  // of a building; cut into a slab per bay it read as shelves floating in front
  // of the arches.
  for (const side of [-1, 1]) {
    root.add(slab([1.7, 0.34, 21.5], [side * 5.75, 4.27, -4.5], stoneDeepMat));
  }

  // A band of tilework at the springing line — the one place in the whole
  // journey where saturated colour is allowed, because that is exactly how
  // Isfahan uses it.
  const tileA = glow(jp.tilework, 0.45);
  const tileB = glow(jp.tileworkAlt, 0.45);
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < 7; bay += 1) {
      const centre = 4.5 - bay * 3.02;
      // Only on the piers. Run as one continuous course and the band crosses
      // the arch openings, where it hangs in mid-air with nothing behind it.
      for (const pier of [-1.18, 1.18]) {
        root.add(
          slab(
            [0.07, 0.3, 0.62],
            [side * 5.1, 2.2, centre + pier],
            (bay + (pier > 0 ? 1 : 0)) % 2 === 0 ? tileA : tileB
          )
        );
      }
    }
  }

  // The reflecting pool. Low roughness plus the environment map is what turns a
  // flat plane into water; the fog colour it reflects sells the night sky.
  // The kerb first, then the water surface sitting proud of it. Built the
  // other way round the plane ends up buried inside the kerb solid and the
  // pool simply does not render.
  root.add(slab([5.1, 0.22, 17.6], [0, 0.11, -2], stoneDeepMat));
  const pool = new Mesh(
    new PlaneGeometry(4.5, 17),
    new MeshStandardMaterial({ color: jp.pool, roughness: 0.1, metalness: 0.65 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.17, -2);
  root.add(pool);

  // Cypresses. Nothing else says this courtyard so economically.
  const cypressMat = standard(jp.cypress, { roughness: 1 });
  const cypressGeometry = new ConeGeometry(0.42, 4.2, 7, 1);
  for (const [cx, cz] of [
    [-3.1, 3.6],
    [3.1, 3.6],
    [-3.1, -7.4],
    [3.1, -7.4],
  ] as Array<[number, number]>) {
    const tree = copy(cypressGeometry, cypressMat, [cx, 2.1, cz]);
    tree.scale.setY(1 + ((cx + cz) % 3) * 0.06);
    root.add(tree);
  }

  // Lamps under the arcade, as emissive spheres rather than lights.
  const lampMat = glow(jp.window, 2.4);
  const lampGeometry = new SphereGeometry(0.11, 12, 10);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      root.add(copy(lampGeometry, lampMat, [side * 4.65, 2.75, 3.0 - i * 4.5]));
    }
  }

  return {
    root,
    view: view(anchors.university, [4.6, 2.8, 13.5], [-0.9, 2.5, -6.5]),
    sky: skies.university,
    fog: [8, 32],
    ambient: { color: new Color('#4d5c84'), intensity: 1.1 },
    sun: { color: new Color('#9fb4e6'), intensity: 1.7, position: [10, 14, 8] },
    accent: {
      color: jp.window,
      intensity: 16,
      distance: 24,
      position: at(anchors.university, [0, 3.2, 0]),
    },
    stars: 0.85,
  };
}

// ---------------------------------------------------------------------------
// Chapter 04 — Isfahan to Tehran
// ---------------------------------------------------------------------------

function buildCity(): Stage {
  const root = new Group();
  root.position.x = anchors.city;
  const random = seeded(571023);

  root.add(ground(26, 46, standard(jp.asphalt, { roughness: 0.95 }), 2));

  const towerMats = [
    standard(jp.tower, { roughness: 0.75, metalness: 0.15 }),
    standard(jp.towerAlt, { roughness: 0.7, metalness: 0.2 }),
  ];
  const officeMat = glow(jp.officeLight, 0.5);

  // Everything sits well behind the camera stop, so the chapter reads as a
  // skyline rather than as the base of one building. Standing inside the grid
  // there is always an unlit block a few metres from the lens, and it eats the
  // frame no matter where the camera looks.
  for (let gx = 0; gx < 7; gx += 1) {
    for (let gz = 0; gz < 8; gz += 1) {
      const x = -13 + gx * 4.3 + random() * 1.6;
      const z = -4 - gz * 4.3 + random() * 1.6;
      // A corridor left open down the middle for the street below.
      if (Math.abs(x + 1.5) < 3.4 && gz < 4) continue;

      const width = 1.8 + random() * 1.6;
      const depth = 1.8 + random() * 1.6;
      // Squared random: mostly mid-rise with a few towers, which is what makes
      // a skyline read as a skyline instead of as a bar chart.
      const height = 4 + random() * random() * 22;
      root.add(
        slab([width, height, depth], [x, height / 2, z], towerMats[gz % 2]!, random() * 0.4)
      );

      // Lit floors: thin emissive bands read as a building full of people far
      // more cheaply than a window texture, and cost nothing to light.
      const bands = 2 + Math.floor(random() * 3);
      for (let b = 0; b < bands; b += 1) {
        const y = 1.6 + random() * (height - 2.4);
        root.add(slab([width + 0.03, 0.07 + random() * 0.09, depth + 0.03], [x, y, z], officeMat));
      }
    }
  }

  // A telecom spire, the one silhouette that fixes the skyline as Tehran.
  const spireMat = standard(jp.tower, { roughness: 0.6, metalness: 0.35 });
  const shaft = new Mesh(new CylinderGeometry(0.5, 0.95, 22, 12), spireMat);
  shaft.position.set(-9, 11, -19);
  root.add(shaft);
  const pod = new Mesh(new SphereGeometry(1.5, 18, 14), spireMat);
  pod.position.set(-9, 21, -19);
  pod.scale.set(1, 0.62, 1);
  root.add(pod);
  const podLight = new Mesh(new CylinderGeometry(1.52, 1.52, 0.24, 18), glow(jp.officeLight, 1.0));
  podLight.position.set(-9, 21.1, -19);
  root.add(podLight);
  const mast = new Mesh(new CylinderGeometry(0.06, 0.12, 7, 6), spireMat);
  mast.position.set(-9, 25.5, -19);
  root.add(mast);
  const beacon = new Mesh(
    new SphereGeometry(0.16, 10, 8),
    glow(new Color('#ff5a4d'), 3, { fogged: false })
  );
  beacon.position.set(-9, 29.1, -19);
  root.add(beacon);

  // Sodium street lighting down the avenue, and the traffic under it.
  const sodiumMat = glow(jp.sodium, 2.0);
  const headMat = glow(new Color('#fff2d0'), 1.8);
  const tailMat = glow(new Color('#ff3b30'), 1.6);
  for (let i = 0; i < 10; i += 1) {
    const z = 4 - i * 3.4;
    for (const side of [-1, 1]) {
      const post = new Mesh(
        new CylinderGeometry(0.06, 0.08, 4.4, 6),
        standard(jp.tower, { roughness: 0.6, metalness: 0.3 })
      );
      post.position.set(-1.5 + side * 3.0, 2.2, z);
      root.add(post);
      root.add(slab([0.5, 0.1, 0.24], [-1.5 + side * 2.75, 4.4, z], sodiumMat));
    }
    // Light trails rather than cars: at this scale and this exposure, that is
    // what a city street actually looks like.
    root.add(slab([0.14, 0.06, 2.2 + random() * 2], [-2.6, 0.28, z + random()], tailMat));
    root.add(slab([0.14, 0.06, 2.0 + random() * 2], [-0.4, 0.3, z - random() * 2], headMat));
  }

  return {
    root,
    view: view(anchors.city, [3.0, 3.4, 13.0], [-2.5, 9.0, -16.0]),
    sky: skies.city,
    fog: [9, 40],
    // Sodium haze: the ambient itself is warm here, which is the single biggest
    // reason this chapter reads as a different place from the last one.
    ambient: { color: new Color('#7d5945'), intensity: 1.15 },
    sun: { color: new Color('#c98a5a'), intensity: 2.1, position: [10, 18, 14] },
    accent: {
      color: jp.sodium,
      intensity: 3.5,
      distance: 14,
      position: at(anchors.city, [-1.5, 4.2, 2]),
    },
    stars: 0.12,
  };
}

// ---------------------------------------------------------------------------
// Chapter 05 — the crossing
// ---------------------------------------------------------------------------

function buildCrossing(): Stage {
  const root = new Group();
  root.position.x = anchors.crossing;
  const random = seeded(340726);

  // Water, not ground: the same trick as the courtyard pool at a larger scale.
  const water = new Mesh(
    new PlaneGeometry(22, 48),
    new MeshStandardMaterial({ color: jp.water, roughness: 0.14, metalness: 0.55 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.002;
  root.add(water);

  // The far shore, and the skyline that fixes the place.
  const shoreMat = standard(jp.shore, { roughness: 1 });
  root.add(slab([26, 1.6, 6], [-2, 0.4, -13], shoreMat));

  const domeMat = standard(jp.dome, { roughness: 0.85 });
  const minaretMat = standard(jp.minaret, { roughness: 0.8 });
  const domeGeometry = new SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const minaretShaft = new CylinderGeometry(0.13, 0.17, 5.4, 8);
  const minaretCap = new ConeGeometry(0.2, 1.1, 8);
  const windowMat = glow(jp.officeLight, 1.4);

  // Three mosque complexes: a base, a dome, and paired minarets each.
  for (const [cx, scale] of [
    [-8.5, 1.15],
    [-1.2, 1.5],
    [6.4, 0.95],
  ] as Array<[number, number]>) {
    const baseHeight = 1.9 * scale;
    root.add(
      slab([4.4 * scale, baseHeight, 3.6 * scale], [cx, 1.2 + baseHeight / 2, -12.6], domeMat)
    );

    const dome = copy(domeGeometry, domeMat, [cx, 1.2 + baseHeight, -12.6]);
    dome.scale.setScalar(1.9 * scale);
    root.add(dome);

    // Half-domes flanking the main one, the giveaway of an Ottoman silhouette.
    for (const side of [-1, 1]) {
      const half = copy(domeGeometry, domeMat, [
        cx + side * 2.2 * scale,
        1.2 + baseHeight * 0.55,
        -12.6,
      ]);
      half.scale.setScalar(1.05 * scale);
      root.add(half);
    }

    for (const side of [-1, 1]) {
      const x = cx + side * 3.0 * scale;
      const shaft = copy(minaretShaft, minaretMat, [x, 1.2 + 2.7 * scale, -12.6]);
      shaft.scale.setScalar(scale);
      root.add(shaft);
      const cap = copy(minaretCap, minaretMat, [x, 1.2 + (5.4 * scale) / 2 + 0.55 * scale, -12.6]);
      cap.scale.setScalar(scale);
      root.add(cap);
      // The lit balcony ring.
      root.add(
        slab([0.42 * scale, 0.1 * scale, 0.42 * scale], [x, 1.2 + 4.0 * scale, -12.6], windowMat)
      );
    }
  }

  // Shore lights, scattered along the waterfront.
  const shoreLightGeometry = new SphereGeometry(0.09, 8, 6);
  const shoreLightMat = glow(jp.officeLight, 2.0);
  for (let i = 0; i < 34; i += 1) {
    root.add(
      copy(shoreLightGeometry, shoreLightMat, [
        -13 + random() * 26,
        1.3 + random() * 0.8,
        -10 + random() * 1.4,
      ])
    );
  }

  // The bridge. Two towers, a catenary main cable, hangers, and a lit deck.
  const bridgeMat = standard(jp.bridge, { roughness: 0.65, metalness: 0.35 });
  const cableMat = standard(jp.cable, { roughness: 0.5, metalness: 0.6 });
  const towerX = [-6.5, 6.5];
  const deckY = 4.6;
  const towerHeight = 11.5;

  for (const x of towerX) {
    for (const zOffset of [-1.1, 1.1]) {
      root.add(slab([0.72, towerHeight, 0.72], [x, towerHeight / 2, -6 + zOffset], bridgeMat));
    }
    root.add(slab([0.72, 0.5, 3.0], [x, towerHeight - 0.6, -6], bridgeMat));
    root.add(slab([0.72, 0.4, 3.0], [x, deckY + 1.4, -6], bridgeMat));
  }

  root.add(slab([26, 0.28, 3.4], [0, deckY, -6], bridgeMat));
  root.add(slab([26, 0.1, 3.5], [0, deckY + 0.2, -6], glow(jp.officeLight, 0.9)));

  // Main cable as a tube along a sagging curve, which is the difference between
  // a suspension bridge and a box on stilts.
  for (const zOffset of [-1.5, 1.5]) {
    const curve = new CatmullRomCurve3([
      new Vector3(-13, deckY - 0.2, -6 + zOffset),
      new Vector3(-6.5, towerHeight - 0.4, -6 + zOffset),
      new Vector3(0, deckY + 1.9, -6 + zOffset),
      new Vector3(6.5, towerHeight - 0.4, -6 + zOffset),
      new Vector3(13, deckY - 0.2, -6 + zOffset),
    ]);
    root.add(new Mesh(new TubeGeometry(curve, 64, 0.075, 6, false), cableMat));

    // Hangers dropped from the cable to the deck.
    for (let i = 1; i < 40; i += 1) {
      const t = i / 40;
      const point = curve.getPoint(t);
      if (point.y - deckY < 0.35) continue;
      const height = point.y - deckY;
      root.add(slab([0.035, height, 0.035], [point.x, deckY + height / 2, point.z], cableMat));
    }
  }

  // A ferry crossing under it, because that is the actual daily image of the
  // city and it gives the chapter something moving.
  const ferry = new Group();
  ferry.add(slab([2.4, 0.5, 0.9], [0, 0.25, 0], standard(jp.ferry, { roughness: 0.7 })));
  ferry.add(slab([1.5, 0.55, 0.8], [-0.1, 0.75, 0], standard(jp.ferry, { roughness: 0.6 })));
  ferry.add(slab([1.52, 0.2, 0.82], [-0.1, 0.78, 0], glow(jp.officeLight, 2.2)));
  const funnel = new Mesh(
    new CylinderGeometry(0.11, 0.13, 0.6, 10),
    standard(jp.ferry, { roughness: 0.7 })
  );
  funnel.position.set(-0.5, 1.3, 0);
  ferry.add(funnel);
  ferry.position.set(1.5, 0, -9);
  root.add(ferry);

  return {
    root,
    view: view(anchors.crossing, [2.0, 3.2, 11.0], [-4.0, 5.0, -6.5]),
    sky: skies.crossing,
    fog: [11, 44],
    // Blue hour: cold ambient, cold key, and every warm note coming from the
    // city itself.
    ambient: { color: new Color('#42598c'), intensity: 1.15 },
    sun: { color: new Color('#7f9ad6'), intensity: 1.75, position: [-14, 9, -18] },
    accent: {
      color: jp.officeLight,
      intensity: 5,
      distance: 20,
      position: at(anchors.crossing, [0, 5.5, -8]),
    },
    stars: 0.55,
    tick: (t) => {
      // A slow drift across the strait plus the roll of a hull on water.
      ferry.position.z = -9 + Math.sin(t * 0.09) * 5.5;
      ferry.position.y = Math.sin(t * 0.9) * 0.035;
      ferry.rotation.z = Math.sin(t * 0.7) * 0.02;
    },
  };
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

/**
 * A star dome parented to a group the renderer keeps centred on the camera, so
 * the stars stay at infinity across ninety units of travel instead of sliding
 * past like confetti.
 */
export function buildStars() {
  const count = 1100;
  const positions = new Float32Array(count * 3);
  const random = seeded(90210);

  for (let i = 0; i < count; i += 1) {
    // Rejection toward the upper hemisphere: stars below the horizon are just
    // fill rate spent on something the ground hides.
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(random() * 0.92);
    const radius = 120;
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[i * 3 + 1] = Math.cos(phi) * radius;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

  const material = new PointsMaterial({
    color: new Color('#cfd9ff'),
    size: 1.35,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, material };
}

// ---------------------------------------------------------------------------

export interface JourneyBuild {
  root: Group;
  stages: Stage[];
  stars: ReturnType<typeof buildStars>;
}

/**
 * The five chapters that lead to the room, ordered as the camera meets them.
 * The room itself is added by the renderer, which already owns it.
 */
export function buildJourney(): JourneyBuild {
  const root = new Group();
  const stages = [buildVillage(), buildExam(), buildUniversity(), buildCity(), buildCrossing()];
  for (const stage of stages) root.add(stage.root);
  return { root, stages, stars: buildStars() };
}

/** Kept exported so the room's own viewpoints live next to the journey's. */
export const roomViews: View[] = [
  // Arrival: the room seen whole, from the open corner the journey approaches.
  { position: [3.5, 2.5, 3.4], target: [0, 1.05, -1.5] },
  // Settling in at the desk.
  { position: [2.05, 1.5, 1.6], target: [0.15, 1.0, -1.6] },
  // Close on the screens, which is where the work actually is.
  { position: [0.9, 1.24, 0.5], target: [0.0, 1.06, -1.75] },
];

export const roomSky = skies.room;
