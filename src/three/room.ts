import type { Color } from 'three';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type Texture,
} from 'three';
import { palette } from './palette';
import { box, standard, type Vec3 } from './primitives';

/** Desk, its frame and the objects sitting on it. */
function buildDesk() {
  const group = new Group();
  const topMat = standard(palette.deskTop, { roughness: 0.6 });
  const frameMat = standard(palette.deskFrame, { roughness: 0.5, metalness: 0.3 });

  group.add(box([3.4, 0.07, 1.35], [0, 0.74, 0], topMat));
  group.add(box([0.07, 0.74, 1.2], [-1.6, 0.37, 0], frameMat));
  group.add(box([0.07, 0.74, 1.2], [1.6, 0.37, 0], frameMat));
  group.add(box([3.2, 0.05, 0.06], [0, 0.2, -0.5], frameMat));

  return group;
}

function buildMonitor(
  screenTexture: Texture,
  width: number,
  height: number,
  position: Vec3,
  rotationY: number
) {
  const group = new Group();
  const shell = standard(palette.plastic, { roughness: 0.5, metalness: 0.2 });

  group.add(box([width + 0.06, height + 0.06, 0.05], [0, height / 2, 0], shell));

  const screen = new Mesh(
    new PlaneGeometry(width, height),
    new MeshStandardMaterial({
      map: screenTexture,
      emissiveMap: screenTexture,
      emissive: palette.screenGlow,
      emissiveIntensity: 0.95,
      roughness: 0.35,
      metalness: 0,
    })
  );
  screen.position.set(0, height / 2, 0.028);
  group.add(screen);

  // Stand
  group.add(box([0.12, 0.26, 0.08], [0, -0.13 + 0.13, 0], shell));
  const base = new Mesh(new CylinderGeometry(0.22, 0.24, 0.03, 24), shell);
  base.castShadow = true;
  group.add(base);

  group.position.set(...position);
  group.rotation.y = rotationY;
  return group;
}

function buildKeyboard() {
  const group = new Group();
  const bodyMat = standard(palette.plastic, { roughness: 0.6 });
  const keyMat = standard(palette.keycap, { roughness: 0.75 });

  group.add(box([0.86, 0.025, 0.3], [0, 0, 0], bodyMat));

  const cols = 14;
  const rows = 4;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const key = new Mesh(new BoxGeometry(0.045, 0.012, 0.045), keyMat);
      key.position.set(-0.39 + c * 0.06, 0.019, -0.1 + r * 0.06);
      key.castShadow = true;
      group.add(key);
    }
  }
  return group;
}

function buildMug() {
  const group = new Group();
  const mat = standard(palette.lampShade, { roughness: 0.4 });
  const body = new Mesh(new CylinderGeometry(0.055, 0.048, 0.11, 20), mat);
  body.position.y = 0.055;
  body.castShadow = true;
  group.add(body);

  const handle = new Mesh(new TorusGeometry(0.035, 0.011, 8, 18), mat);
  handle.position.set(0.062, 0.06, 0);
  handle.rotation.y = Math.PI / 2;
  group.add(handle);

  const coffee = new Mesh(
    new CylinderGeometry(0.05, 0.05, 0.005, 20),
    standard(palette.deskTop, { roughness: 0.2 })
  );
  coffee.position.y = 0.106;
  group.add(coffee);
  return group;
}

function buildLamp() {
  const group = new Group();
  const mat = standard(palette.metal, { roughness: 0.35, metalness: 0.6 });

  const base = new Mesh(new CylinderGeometry(0.1, 0.12, 0.022, 20), mat);
  base.castShadow = true;
  group.add(base);

  // Upright post, then a forward-reaching arm, then the shade angled at the desk.
  const post = new Mesh(new CylinderGeometry(0.012, 0.012, 0.46, 12), mat);
  post.position.set(0, 0.24, 0);
  group.add(post);

  const arm = new Mesh(new CylinderGeometry(0.011, 0.011, 0.32, 12), mat);
  arm.position.set(0.14, 0.45, 0.02);
  arm.rotation.z = Math.PI / 2 - 0.35;
  group.add(arm);

  const shade = new Mesh(
    new ConeGeometry(0.1, 0.15, 22, 1, true),
    new MeshStandardMaterial({
      color: palette.lampShade,
      roughness: 0.5,
      side: DoubleSide,
      emissive: palette.lampWarm,
      emissiveIntensity: 0.4,
    })
  );
  // Cone apex up, mouth down, tilted slightly toward the desk surface.
  shade.position.set(0.28, 0.4, 0.04);
  shade.rotation.z = 0.35;
  group.add(shade);

  const bulb = new Mesh(
    new SphereGeometry(0.03, 12, 12),
    new MeshStandardMaterial({
      color: palette.lampWarm,
      emissive: palette.lampWarm,
      emissiveIntensity: 4,
    })
  );
  bulb.position.set(0.29, 0.35, 0.04);
  group.add(bulb);

  return { group, bulbPosition: [0.29, 0.33, 0.04] as Vec3 };
}

function buildPlant() {
  const group = new Group();
  const pot = new Mesh(
    new CylinderGeometry(0.16, 0.12, 0.26, 18),
    standard(palette.plantPot, { roughness: 0.9 })
  );
  pot.position.y = 0.13;
  pot.castShadow = true;
  group.add(pot);

  const soil = new Mesh(
    new CylinderGeometry(0.15, 0.15, 0.02, 18),
    standard(palette.floor, { roughness: 1 })
  );
  soil.position.y = 0.26;
  group.add(soil);

  const leafMat = standard(palette.plantLeaf, { roughness: 0.75 });
  const leaves = new Group();
  for (let i = 0; i < 9; i += 1) {
    const leaf = new Mesh(new SphereGeometry(0.11, 8, 6), leafMat);
    const angle = (i / 9) * Math.PI * 2;
    const radius = 0.1 + (i % 3) * 0.05;
    leaf.position.set(Math.cos(angle) * radius, 0.36 + (i % 4) * 0.11, Math.sin(angle) * radius);
    leaf.scale.set(1, 1.7, 0.5);
    leaf.rotation.set(0.3, angle, Math.cos(angle) * 0.5);
    leaf.castShadow = true;
    leaves.add(leaf);
  }
  group.add(leaves);
  return { group, leaves };
}

function buildChair() {
  const group = new Group();
  const mat = standard(palette.chair, { roughness: 0.8 });
  const metal = standard(palette.metal, { roughness: 0.4, metalness: 0.6 });

  group.add(box([0.52, 0.08, 0.5], [0, 0.46, 0], mat));

  const back = box([0.5, 0.62, 0.07], [0, 0.8, -0.24], mat);
  back.rotation.x = -0.12;
  group.add(back);

  const post = new Mesh(new CylinderGeometry(0.035, 0.035, 0.42, 12), metal);
  post.position.y = 0.24;
  group.add(post);

  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const leg = new Mesh(new BoxGeometry(0.05, 0.03, 0.3), metal);
    leg.position.set(Math.cos(angle) * 0.14, 0.05, Math.sin(angle) * 0.14);
    leg.rotation.y = -angle;
    group.add(leg);
  }
  return group;
}

/** Framed prints, so the back wall is not a blank plane. */
function buildFrames() {
  const group = new Group();
  const frameMat = standard(palette.darkMetal, { roughness: 0.5, metalness: 0.3 });

  const specs: Array<{ w: number; h: number; x: number; y: number; tint: Color }> = [
    { w: 0.4, h: 0.52, x: 0, y: 0, tint: palette.rug },
    { w: 0.3, h: 0.24, x: 0.46, y: 0.1, tint: palette.deskMat },
    { w: 0.26, h: 0.2, x: 0.44, y: -0.2, tint: palette.wallTrim },
  ];

  for (const spec of specs) {
    group.add(box([spec.w, spec.h, 0.03], [spec.x, spec.y, 0], frameMat));
    const art = new Mesh(
      new PlaneGeometry(spec.w - 0.06, spec.h - 0.06),
      new MeshStandardMaterial({ color: spec.tint, roughness: 0.9 })
    );
    art.position.set(spec.x, spec.y, 0.02);
    group.add(art);
  }
  return group;
}

function buildShelf() {
  const group = new Group();
  const shelfMat = standard(palette.deskTop, { roughness: 0.7 });
  group.add(box([1.5, 0.05, 0.26], [0, 0, 0], shelfMat));

  const bookColors = [palette.primary, palette.accent, palette.plantLeaf, palette.lampWarm];
  for (let i = 0; i < 9; i += 1) {
    const height = 0.2 + (i % 3) * 0.05;
    const color = bookColors[i % bookColors.length];
    if (!color) continue;
    const bookMat = standard(color, { roughness: 0.85 });
    const book = box([0.045, height, 0.18], [-0.62 + i * 0.055, height / 2 + 0.025, 0], bookMat);
    book.rotation.z = i === 6 ? 0.2 : 0;
    group.add(book);
  }

  const trinket = new Mesh(
    new IcosahedronGeometry(0.075, 0),
    standard(palette.accent, {
      roughness: 0.3,
      metalness: 0.4,
      emissive: palette.accent,
      emissiveIntensity: 0.35,
    })
  );
  trinket.position.set(0.55, 0.1, 0);
  trinket.castShadow = true;
  group.add(trinket);

  return { group, trinket };
}

/**
 * The tower, stood on the floor beside the desk rather than hidden under it —
 * it is one of the things a visitor can open, so it has to be somewhere the
 * camera can actually see from every stop in the room.
 */
function buildTower() {
  const group = new Group();
  const caseMat = standard(palette.plastic, { roughness: 0.42, metalness: 0.35 });

  group.add(box([0.42, 0.9, 0.86], [0, 0.45, 0], caseMat));

  // A tempered side panel with the internals glowing behind it. Rendering the
  // components would cost hundreds of triangles nobody can resolve at this
  // distance; a tinted panel over a coloured wash reads the same.
  const interior = new Mesh(
    new PlaneGeometry(0.72, 0.74),
    new MeshStandardMaterial({
      color: palette.primary,
      emissive: palette.primary,
      emissiveIntensity: 0.55,
      roughness: 0.5,
    })
  );
  interior.position.set(0.212, 0.46, 0);
  interior.rotation.y = Math.PI / 2;
  group.add(interior);

  const glass = new Mesh(
    new PlaneGeometry(0.78, 0.8),
    new MeshStandardMaterial({
      color: palette.bezel,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
    })
  );
  glass.position.set(0.216, 0.46, 0);
  glass.rotation.y = Math.PI / 2;
  group.add(glass);

  // Two fans and a front strip, which is what actually reads as a computer.
  const fanMat = standard(palette.accent, {
    roughness: 0.4,
    emissive: palette.accent,
    emissiveIntensity: 1.4,
  });
  const fans = new Group();
  for (const y of [0.3, 0.62]) {
    const fan = new Mesh(new TorusGeometry(0.075, 0.014, 8, 20), fanMat);
    fan.position.set(0.213, y, 0.2);
    fan.rotation.y = Math.PI / 2;
    fans.add(fan);
  }
  group.add(fans);

  group.add(
    box(
      [0.03, 0.5, 0.02],
      [-0.208, 0.5, -0.3],
      standard(palette.screenGlow, {
        roughness: 0.3,
        emissive: palette.screenGlow,
        emissiveIntensity: 1.8,
      })
    )
  );

  return { group, fans };
}

/** The award from the shelf, brought onto the desk where it can be seen. */
function buildTrophy() {
  const group = new Group();
  const metal = standard(palette.lampWarm, {
    roughness: 0.22,
    metalness: 0.85,
    emissive: palette.lampWarm,
    emissiveIntensity: 0.18,
  });

  const base = new Mesh(new CylinderGeometry(0.075, 0.085, 0.035, 20), standard(palette.bezel));
  base.position.y = 0.018;
  base.castShadow = true;
  group.add(base);

  const stem = new Mesh(new CylinderGeometry(0.016, 0.022, 0.09, 12), metal);
  stem.position.y = 0.08;
  group.add(stem);

  const cup = new Mesh(new SphereGeometry(0.055, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  cup.position.y = 0.125;
  cup.rotation.x = Math.PI;
  cup.scale.set(1, 1.25, 1);
  group.add(cup);

  for (const side of [-1, 1]) {
    const handle = new Mesh(new TorusGeometry(0.026, 0.007, 6, 14), metal);
    handle.position.set(side * 0.058, 0.145, 0);
    handle.rotation.y = Math.PI / 2;
    group.add(handle);
  }

  return group;
}

export interface RoomBuild {
  root: Group;
  /** Animated in the render loop. */
  animated: {
    leaves: Group;
    trinket: Mesh;
    screens: Mesh[];
    fans: Group;
  };
  lampPosition: Vec3;
}

export function buildRoom(textures: {
  code: Texture;
  projects: Texture;
  terminal: Texture;
}): RoomBuild {
  const root = new Group();

  // Shell -----------------------------------------------------------------
  const floor = new Mesh(new PlaneGeometry(14, 14), standard(palette.floor, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const rug = new Mesh(new PlaneGeometry(4.2, 3), standard(palette.rug, { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.004, 0.6);
  rug.receiveShadow = true;
  root.add(rug);

  const wallMat = standard(palette.wall, { roughness: 0.95 });
  const backWall = new Mesh(new PlaneGeometry(14, 6), wallMat);
  backWall.position.set(0, 3, -2.2);
  backWall.receiveShadow = true;
  root.add(backWall);

  const sideWall = new Mesh(new PlaneGeometry(9, 6), wallMat);
  sideWall.rotation.y = Math.PI / 2;
  sideWall.position.set(-3.4, 3, 2.3);
  sideWall.receiveShadow = true;
  root.add(sideWall);

  root.add(box([14, 0.12, 0.1], [0, 0.06, -2.15], standard(palette.wallTrim)));

  // Desk ------------------------------------------------------------------
  const desk = buildDesk();
  desk.position.set(0, 0, -1.4);
  root.add(desk);

  const screens: Mesh[] = [];
  const centre = buildMonitor(textures.projects, 1.05, 0.62, [0, 1.06, -1.72], 0);
  const left = buildMonitor(textures.code, 0.8, 0.5, [-1.05, 1.0, -1.62], 0.42);
  const right = buildMonitor(textures.terminal, 0.44, 0.7, [1.02, 1.06, -1.62], -0.42);
  [centre, left, right].forEach((monitor) => {
    root.add(monitor);
    const screen = monitor.children.find(
      (child): child is Mesh => child instanceof Mesh && child.geometry instanceof PlaneGeometry
    );
    if (screen) screens.push(screen);
  });

  const deskMat = new Mesh(
    new PlaneGeometry(1.5, 0.5),
    standard(palette.deskMat, { roughness: 0.95 })
  );
  deskMat.rotation.x = -Math.PI / 2;
  deskMat.position.set(0.05, 0.778, -1.16);
  deskMat.receiveShadow = true;
  root.add(deskMat);

  const keyboard = buildKeyboard();
  keyboard.position.set(-0.05, 0.79, -1.15);
  root.add(keyboard);

  const mouse = new Mesh(
    new SphereGeometry(0.05, 16, 12),
    standard(palette.plastic, { roughness: 0.5 })
  );
  mouse.scale.set(0.75, 0.45, 1.15);
  mouse.position.set(0.56, 0.81, -1.13);
  mouse.castShadow = true;
  root.add(mouse);

  const mug = buildMug();
  mug.position.set(-0.72, 0.78, -1.06);
  root.add(mug);

  const phone = box(
    [0.09, 0.005, 0.17],
    [0.85, 0.785, -1.35],
    standard(palette.primary, {
      roughness: 0.3,
      emissive: palette.primary,
      emissiveIntensity: 0.25,
    }),
    -0.3
  );
  root.add(phone);

  const lamp = buildLamp();
  lamp.group.position.set(-1.45, 0.775, -1.62);
  lamp.group.rotation.y = 0.5;
  root.add(lamp.group);

  // Room dressing ---------------------------------------------------------
  const plant = buildPlant();
  plant.group.position.set(2.15, 0, -1.5);
  root.add(plant.group);

  const chair = buildChair();
  // Pushed left and turned: parked in front of the desk it read as a dark slab
  // occluding the screens rather than as a chair.
  chair.position.set(-0.95, 0, -0.15);
  chair.rotation.y = 0.55;
  root.add(chair);

  const shelf = buildShelf();
  shelf.group.position.set(-1.5, 1.95, -2.05);
  root.add(shelf.group);

  const frames = buildFrames();
  frames.position.set(-2.5, 1.75, -2.16);
  root.add(frames);

  const tower = buildTower();
  tower.group.position.set(1.62, 0, -1.15);
  tower.group.rotation.y = -0.42;
  root.add(tower.group);

  const trophy = buildTrophy();
  trophy.position.set(-1.32, 0.778, -1.15);
  root.add(trophy);

  return {
    root,
    animated: { leaves: plant.leaves, trinket: shelf.trinket, screens, fans: tower.fans },
    lampPosition: [
      lamp.group.position.x + lamp.bulbPosition[0],
      lamp.group.position.y + lamp.bulbPosition[1],
      lamp.group.position.z + lamp.bulbPosition[2],
    ],
  };
}
