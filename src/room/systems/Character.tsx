import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import type { Group } from 'three';
import {
  AdditiveBlending,
  Box3,
  Color,
  ConeGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Raycaster,
  Vector3,
  type Object3D,
} from 'three';
import { useEngine } from '../engine/store';
import { characterState } from '../engine/characterState';
import { aimLook, resetLook, splitLook } from '../engine/lookControl';
import { roomAudio } from '../engine/audio';
import type { ObjectId } from '../data/objects';

/**
 * The desk robot, and the game layer it carries.
 *
 * `build_character.py` made one decision this whole file leans on: the robot
 * is rigid parts hinged at their pivots, not a skinned mesh. There are no
 * animation clips to load and none are needed — every pose is joint rotations
 * driven by the body's own state, and every gait number is derived from the
 * 12 cm frame. The desk at 79 cm stands 6.6 robot-heights tall, which is why
 * the room reads as a city from down on the boards.
 *
 * It flies rather than climbs, and that is the honest solution rather than a
 * shortcut. A machine with three-fingered grippers and no shoulders worth the
 * name was never going to haul itself up a table leg convincingly — every
 * mantle animation fought the design. Thrusters under the feet fit what this
 * body actually is, and they turn the room's verticality from a wall into an
 * invitation: hold Space and the whole desk is reachable from any edge, not
 * from six authored spots.
 *
 * Flight is deliberately not free. Fuel drains while the thrusters burn and
 * only refills on the ground, and an altitude ceiling keeps the robot in the
 * furniture rather than up at the picture rail — limits are what make a
 * traversal system a game instead of a camera.
 */

/** Where the robot starts: on the floorboards in front of the desk. */
const HOME = new Vector3(0.05, 0.006, 1.3);

/** How far the robot may roam. The left bound reaches into the bookcase
 * rather than stopping at its front edge: the shelf boards are landing pads
 * once the robot can fly, and a shelf you can hover beside but never set
 * down on is a tease. */
const ROOM_BOUNDS = { minX: -3.12, maxX: 3.0, minZ: -2.3, maxZ: 2.44 };

/** The big casework, with the heights it actually occupies. Tops matter now
 * that the robot flies: a wall the length of the sofa would fence off half
 * the room at altitude, when what is really there is a piece of furniture
 * you can pass above and land on. */
const BOXES = [
  { minX: -0.88, maxX: 1.28, minZ: -2.1, maxZ: -1.3, top: 0.478 }, // sofa seat
  { minX: -0.88, maxX: 1.28, minZ: -2.1, maxZ: -1.86, top: 0.96 }, // its back
  { minX: -2.7, maxX: -2.16, minZ: 1.5, maxZ: 2.44, top: 1.02 }, // dresser
  { minX: 0.28, maxX: 0.9, minZ: 1.78, maxZ: 2.44, top: 0.75 }, // desk pedestal
];
const CIRCLES = [
  { x: -1.22, z: -1.85, r: 0.17 }, // floor lamp base
  { x: 1.62, z: -0.55, r: 0.2 }, // side table foot
  { x: 2.78, z: -0.35, r: 0.2 }, // plant pot
  { x: 1.34, z: 1.92, r: 0.16 }, // bin
  { x: 0.45, z: 0.81, r: 0.28 }, // chair base star
  { x: 2.95, z: -0.6, r: 0.22 }, // guitar and stand
  { x: -0.25, z: -0.28, r: 0.05 }, // coffee table legs …
  { x: 0.75, z: -0.28, r: 0.05 },
  { x: -0.25, z: -0.72, r: 0.05 },
  { x: 0.75, z: -0.72, r: 0.05 },
];

/** Metres per second, scaled from a human walk by the 0.12 m body.
 *
 * Raised from 0.14/0.28. The original figures were derived honestly — they are
 * a human gait divided by the robot's height — and they were wrong for the
 * room anyway. A visitor is not living at robot scale; they are crossing a six
 * metre room to get somewhere, and a physically faithful 0.14 m/s makes that a
 * forty-second walk. Scale realism lost to the thing it was serving. */
const WALK_SPEED = 0.2;
const RUN_SPEED = 0.44;
const BACK_SPEED = 0.07;
const TURN_SPEED = 3.4;
/** The view angles live in `lookControl`: the pointer aims them, the camera
 * takes them whole, and the neck takes only as much as a neck can. Steering
 * the *body* with the mouse as well meant the two fought each other — you
 * could not look at something without walking towards it — so A and D turn
 * the body and the mouse only ever moves the view. */

/** The floor, and the rug standing 16 mm proud of it. */
const FLOOR_Y = 0.006;
const RUG = { minX: -1.72, maxX: 2.12, minZ: -2.52, maxZ: 0.92, y: 0.0235 };

const GRAVITY = 2.8;
/** A step this small is walked up rather than flown over. */
const STEP_UP = 0.026;
/** Ledges whose undersides clear the head are ceilings: walked under. */
const HEAD_CLEAR = 0.2;

/** --- flight ------------------------------------------------------------
 * Thrust beats gravity by about the same margin gravity beats it back, so
 * the robot rises and falls at a pace the eye can follow rather than
 * snapping between altitudes. Rise and fall are both clamped: unclamped,
 * a long hold reads as a rocket and a long fall as a dropped stone.
 */
const THRUST_ACCEL = 8.2;
const RISE_CLAMP = 1.05;
const FALL_CLAMP = 1.1;
/** The ceiling, in world metres — high enough to put the whole room in
 * play: the desk at 0.79, the shelf's capping board at 2.18, the picture
 * rail. Still a ceiling, because a robot that can leave the room has no
 * room to explore; it just stops short of the 2.6 m walls. */
const CEILING = 2.34;
/** Thrust fades over the last stretch below the ceiling, so the robot eases
 * into its limit instead of hitting an invisible lid. */
const CEILING_FADE = 0.24;
/** Seconds of continuous burn, and how fast the tank refills on the ground.
 * Long enough to cross the room at altitude and pick a landing — the tank
 * is a budget for a trip, not for a hop. */
const FUEL_MAX = 8.5;
const FUEL_REFILL = 2.6;
/** Below this the thrusters will not relight — no sputtering on fumes. */
const FUEL_RELIGHT = 0.22;
/** Air speed, as a multiple of ground speed. A jetpack that crawls is a
 * lift; holding thrust and forward should genuinely fly the room — and at 1.45
 * on top of the old walk speed it still crawled. Flight is now clearly the
 * fast way to travel, which is what makes the fuel budget a decision. */
const AIR_CONTROL = 2.1;

/** How close counts as "standing at" an interactable, in metres. */
const REACH = 0.3;
/** …and how close in *height*. Without this the robot could read the CV on
 * the desk while standing on the floor 80 cm below it, which is the whole
 * reason the desk is worth flying to. */
const REACH_HEIGHT = 0.34;

/** Joint swing amplitudes, radians. Tuned to the leg proportions. */
const GAIT = { hip: 0.65, knee: 0.75, arm: 0.5, bob: 0.0035, lean: 0.12 };

const keys = new Set<string>();

interface Joints {
  hips: Object3D | undefined;
  head: Object3D | undefined;
  hipL: Object3D | undefined;
  hipR: Object3D | undefined;
  kneeL: Object3D | undefined;
  kneeR: Object3D | undefined;
  shoulderL: Object3D | undefined;
  shoulderR: Object3D | undefined;
  footL: Object3D | undefined;
  footR: Object3D | undefined;
}

export function Character({ root }: { root: Object3D }) {
  const gltf = useGLTF('/models/character.glb');
  const controlled = useEngine((state) => state.controlled);
  const focused = useEngine((state) => state.focused);
  const setNearby = useEngine((state) => state.setNearby);
  const nearby = useEngine((state) => state.nearby);
  const focus = useEngine((state) => state.focus);
  const setControlled = useEngine((state) => state.setControlled);
  const setNearGuitar = useEngine((state) => state.setNearGuitar);

  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<RapierRigidBody>(null);
  const position = useRef(new Vector3().copy(HOME));
  const heading = useRef(Math.PI);
  const speed = useRef(0);
  const gaitPhase = useRef(0);
  const idleClock = useRef(0);
  const verticalSpeed = useRef(0);
  const grounded = useRef(true);
  const landing = useRef(0);
  const headYaw = useRef(0);
  const headPitch = useRef(0);
  const lookTarget = useRef<Vector3 | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  /** 0..1, how hard the thrusters are burning right now. Eased, so the
   * flames swell and die rather than blinking with the key. */
  const thrust = useRef(0);
  const fuel = useRef(FUEL_MAX);
  const tilt = useRef(0);

  /**
   * The ground finder.
   *
   * One ray, straight down from just above the feet, against the room as it
   * actually is. This replaces the authored list of decks it used to carry,
   * and the difference is not tidiness — it is that *everything* is now a
   * landing pad. The chair's seat, the lamp's base, the shelf's capping
   * board, the top of the guitar case, a book left lying on the sofa: all
   * of them are ground the moment the geometry says so, with nothing to
   * declare and nothing to keep in step when the room changes.
   *
   * It starts from the feet rather than from overhead so a surface above
   * the robot can never yank it upward — standing under the desk finds the
   * floor, not the desk — and it reaches back far enough to cover the
   * distance a fast fall crosses in one frame, which is what stops the
   * robot tunnelling through a thin shelf at low frame rates.
   */
  const raycaster = useMemo(() => {
    const caster = new Raycaster();
    caster.far = 4;
    return caster;
  }, []);
  const down = useMemo(() => new Vector3(0, -1, 0), []);
  const probe = useMemo(() => new Vector3(), []);

  const joints = useMemo<Joints>(() => {
    const scene = gltf.scene;
    return {
      hips: scene.getObjectByName('bot_hips') ?? undefined,
      head: scene.getObjectByName('bot_head') ?? undefined,
      hipL: scene.getObjectByName('bot_hipjoint_l') ?? undefined,
      hipR: scene.getObjectByName('bot_hipjoint_r') ?? undefined,
      kneeL: scene.getObjectByName('bot_knee_l') ?? undefined,
      kneeR: scene.getObjectByName('bot_knee_r') ?? undefined,
      shoulderL: scene.getObjectByName('bot_shoulder_l') ?? undefined,
      shoulderR: scene.getObjectByName('bot_shoulder_r') ?? undefined,
      footL: scene.getObjectByName('bot_foot_l') ?? undefined,
      footR: scene.getObjectByName('bot_foot_r') ?? undefined,
    };
  }, [gltf.scene]);

  // The robot is invisible to raycasts. It is never a click target — the
  // room's objects are — and more importantly the camera's collision ray
  // starts inside its head: left raycastable, the rig would collide with
  // the very character it is following and jam against its own shoulder.
  useEffect(() => {
    gltf.scene.traverse((node) => {
      if (node instanceof Mesh) node.raycast = () => {};
    });
  }, [gltf.scene]);

  /** Rest pose per joint, so animation is applied around it, never onto it. */
  const rest = useMemo(() => {
    const map = new Map<Object3D, { x: number; y: number; z: number }>();
    for (const joint of Object.values(joints)) {
      if (joint) map.set(joint, { x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z });
    }
    return map;
  }, [joints]);

  /**
   * The exhaust: two flames under the feet and the light they cast.
   *
   * Each flame is two cones — a small white-hot core inside a wider cyan
   * plume — because a single cone reads as a traffic bollard however it is
   * coloured. Unlit and additively blended: this is emitted light, not a
   * surface, so it must not take shading from the room and must brighten
   * whatever it overlaps. The point light is what sells it against the
   * floorboards, throwing a moving pool the robot flies on.
   */
  const exhaust = useMemo(() => {
    const core = new MeshBasicMaterial({
      color: new Color('#eafff8'),
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const plume = new MeshBasicMaterial({
      color: new Color('#2ff5c8'),
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    // Cones point +Y by default; flipped so the tip trails downward.
    const coreGeometry = new ConeGeometry(0.0055, 0.028, 10, 1, true);
    const plumeGeometry = new ConeGeometry(0.0092, 0.044, 12, 1, true);

    const flames: Array<{ core: Mesh; plume: Mesh }> = [];
    const group: Object3D[] = [];
    for (const x of [-0.0132, 0.0132]) {
      const coreMesh = new Mesh(coreGeometry, core);
      const plumeMesh = new Mesh(plumeGeometry, plume);
      for (const mesh of [coreMesh, plumeMesh]) {
        mesh.rotation.x = Math.PI;
        mesh.position.set(x, 0.001, -0.002);
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
        mesh.visible = false;
        group.push(mesh);
      }
      // The cone's origin is its middle, so it is dropped by half its
      // length to hang from the sole rather than through the ankle.
      coreMesh.position.y = -0.013;
      plumeMesh.position.y = -0.021;
      flames.push({ core: coreMesh, plume: plumeMesh });
    }

    const light = new PointLight(new Color('#5affd8'), 0, 0.42, 2);
    light.position.set(0, 0.01, 0);
    group.push(light);

    return { flames, light, objects: group };
  }, []);

  /** Everything that stands on the floor or hangs above it, as colliders
   * derived from the geometry itself, so anything added to the room later
   * gets collision without being listed here. */
  const obstacles = useMemo(() => {
    const found: Array<{
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      top: number;
      bottom: number;
    }> = [];
    const box = new Box3();
    const size = new Vector3();
    const skip = /^(floor|rug|board|plank|skirt|wall|curtain|ix_chair|sofa_(base|back|arm)|bot_)/;
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      if (!(node instanceof Mesh) || skip.test(node.name)) return;
      box.setFromObject(node);
      box.getSize(size);
      if (box.min.y > 0.55 || box.max.y < FLOOR_Y + 0.018) return;
      if (size.x * size.z > 0.5 || size.x > 1.4 || size.z > 1.4) return;
      found.push({
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
        top: box.max.y,
        bottom: box.min.y,
      });
    });
    return found;
  }, [root]);

  /** Where the guitar stands, taken from the model rather than written
   * down, so moving it in Blender moves its music with it. */
  const guitarAt = useMemo(() => {
    const found = root.getObjectByName('guitar');
    if (!found) return null;
    const at = new Vector3();
    found.getWorldPosition(at);
    return at;
  }, [root]);

  /** Every interactable in the room, with its full 3D position — height
   * included, because reaching it is now part of the game. */
  const interactables = useMemo(() => {
    const found: Array<{ id: ObjectId; at: Vector3 }> = [];
    const world = new Vector3();
    root.traverse((node) => {
      const id = node.userData.objectId as ObjectId | undefined;
      if (!id) return;
      node.getWorldPosition(world);
      found.push({ id, at: world.clone() });
    });
    return found;
  }, [root]);

  useEffect(() => {
    if (!controlled) return;
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        [
          'w',
          'a',
          's',
          'd',
          ' ',
          'arrowup',
          'arrowdown',
          'arrowleft',
          'arrowright',
          'shift',
        ].includes(key)
      ) {
        keys.add(key);
        event.preventDefault();
      }
      if (key === 'e' && !useEngine.getState().focused) {
        const engine = useEngine.getState();
        // The guitar wins when the robot is standing at it: it is the one
        // object here whose interaction is not a camera move.
        if (engine.nearGuitar) engine.setMusicOpen(!engine.musicOpen);
        else if (engine.nearby) focus(engine.nearby);
      }
      if (key === 'escape' && !useEngine.getState().focused) {
        // Escape closes the guitar before it leaves the room: the innermost
        // thing the visitor opened is the thing they mean to close.
        const engine = useEngine.getState();
        if (engine.musicOpen) engine.setMusicOpen(false);
        else setControlled(false);
      }
    };
    const up = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    // Blur clears the key set: a held Space that never sees its keyup —
    // alt-tab mid-flight — would otherwise burn the tank to empty.
    const blur = () => keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      keys.clear();
    };
  }, [controlled, focus, setControlled]);

  useEffect(() => {
    characterState.active = controlled;
  }, [controlled]);

  useEffect(() => {
    if (!controlled) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
      aimLook(pointer.current.x, pointer.current.y);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [controlled]);

  // Entering and leaving the walk recentres the view, so control never
  // begins with the camera swinging in from wherever the cursor happened to
  // be resting.
  useEffect(() => {
    resetLook();
  }, [controlled]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const group = groupRef.current;
    if (!group) return;

    // --- input to intent -------------------------------------------------
    let drive = 0;
    let steer = 0;
    let wantThrust = false;
    if (controlled && !focused) {
      if (keys.has('w') || keys.has('arrowup')) drive += 1;
      if (keys.has('s') || keys.has('arrowdown')) drive -= 1;
      if (keys.has('a') || keys.has('arrowleft')) steer += 1;
      if (keys.has('d') || keys.has('arrowright')) steer -= 1;
      wantThrust = keys.has(' ');
    }

    heading.current += steer * TURN_SPEED * dt * (drive < 0 ? -1 : 1);

    // --- the thrusters ----------------------------------------------------
    // Fuel gates the burn, the ceiling fades it, and the ease means the
    // flame — and the lift — arrive over a few frames rather than instantly.
    const dry = fuel.current <= 0;
    const relighting = thrust.current < 0.05 && fuel.current < FUEL_RELIGHT;
    const burning = wantThrust && !dry && !relighting;

    const headroom = MathUtils.clamp((CEILING - position.current.y) / CEILING_FADE, 0, 1);
    const targetThrust = burning ? headroom : 0;
    thrust.current += (targetThrust - thrust.current) * (1 - Math.exp(-11 * dt));

    if (burning) {
      fuel.current = Math.max(0, fuel.current - dt);
      verticalSpeed.current += (THRUST_ACCEL * thrust.current - GRAVITY) * dt;
      grounded.current = false;
    }

    const flying = !grounded.current;
    const throttle =
      drive > 0 ? (keys.has('shift') ? RUN_SPEED : WALK_SPEED) : drive < 0 ? -BACK_SPEED : 0;
    // In the air the forward key is the horizontal thruster: faster than
    // the walk it replaces, and slower to arrive and to bleed off, because
    // carried momentum is most of what makes flying feel like flying.
    const targetSpeed = flying ? throttle * AIR_CONTROL : throttle;
    speed.current += (targetSpeed - speed.current) * (1 - Math.exp(-(flying ? 5.5 : 8) * dt));

    if (Math.abs(speed.current) > 0.001) {
      position.current.x += Math.sin(heading.current) * speed.current * dt;
      position.current.z += Math.cos(heading.current) * speed.current * dt;
    }

    // --- walls, ledges and the ground -------------------------------------
    position.current.x = MathUtils.clamp(position.current.x, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX);
    position.current.z = MathUtils.clamp(position.current.z, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ);

    const feetY = position.current.y;
    let support = FLOOR_Y;
    if (
      position.current.x > RUG.minX &&
      position.current.x < RUG.maxX &&
      position.current.z > RUG.minZ &&
      position.current.z < RUG.maxZ
    ) {
      support = RUG.y;
    }
    // Whatever the room puts under the feet is ground. The ray starts a
    // step above them and looks down, so the first thing it meets is the
    // highest surface the robot could be standing on.
    const sweep = Math.max(STEP_UP, Math.abs(verticalSpeed.current) * dt + 0.008);
    probe.set(position.current.x, position.current.y + sweep, position.current.z);
    raycaster.set(probe, down);
    const hits = raycaster.intersectObject(root, true);
    for (const hit of hits) {
      // Faces the robot is inside — the underside of a slab it is beneath —
      // point away from the ray and are not floors.
      if (hit.face && hit.face.normal.y < 0.4) continue;
      if (hit.point.y > support) support = hit.point.y;
      break;
    }

    const RADIUS = 0.024;
    for (const box of [...obstacles, ...BOXES.map((b) => ({ ...b, bottom: 0 }))]) {
      // Flown clear of it, or ducking beneath it: not an obstacle either way.
      if (box.top <= feetY + STEP_UP) {
        const px = position.current.x;
        const pz = position.current.z;
        if (px > box.minX && px < box.maxX && pz > box.minZ && pz < box.maxZ && box.top > support) {
          support = box.top;
        }
        continue;
      }
      if (box.bottom > feetY + HEAD_CLEAR) continue;

      const px = position.current.x;
      const pz = position.current.z;
      const inside =
        px > box.minX - RADIUS &&
        px < box.maxX + RADIUS &&
        pz > box.minZ - RADIUS &&
        pz < box.maxZ + RADIUS;
      if (!inside) continue;

      const pushLeft = px - (box.minX - RADIUS);
      const pushRight = box.maxX + RADIUS - px;
      const pushNear = pz - (box.minZ - RADIUS);
      const pushFar = box.maxZ + RADIUS - pz;
      const smallest = Math.min(pushLeft, pushRight, pushNear, pushFar);
      if (smallest === pushLeft) position.current.x = box.minX - RADIUS;
      else if (smallest === pushRight) position.current.x = box.maxX + RADIUS;
      else if (smallest === pushNear) position.current.z = box.minZ - RADIUS;
      else position.current.z = box.maxZ + RADIUS;
    }

    for (const circle of CIRCLES) {
      const dx = position.current.x - circle.x;
      const dz = position.current.z - circle.z;
      const distance = Math.hypot(dx, dz);
      if (distance < circle.r && distance > 1e-5) {
        position.current.x = circle.x + (dx / distance) * circle.r;
        position.current.z = circle.z + (dz / distance) * circle.r;
      }
    }

    // Gravity and the ceiling.
    if (!burning && (position.current.y > support + 1e-4 || verticalSpeed.current > 0)) {
      verticalSpeed.current -= GRAVITY * dt;
      grounded.current = false;
    }
    verticalSpeed.current = MathUtils.clamp(verticalSpeed.current, -FALL_CLAMP, RISE_CLAMP);
    if (!grounded.current) position.current.y += verticalSpeed.current * dt;
    if (position.current.y > CEILING) {
      position.current.y = CEILING;
      verticalSpeed.current = Math.min(0, verticalSpeed.current);
    }
    if (position.current.y <= support) {
      if (!grounded.current && verticalSpeed.current < -0.35) {
        landing.current = Math.min(0.24, -verticalSpeed.current * 0.22);
        // Touchdown, and only a real one: a drop slow enough not to bend the
        // knees does not deserve a thump either.
        roomAudio.play('land');
      }
      position.current.y = support;
      verticalSpeed.current = 0;
      grounded.current = true;
    }
    if (grounded.current && !burning) {
      fuel.current = Math.min(FUEL_MAX, fuel.current + FUEL_REFILL * dt);
    }
    landing.current = Math.max(0, landing.current - dt);

    // --- gait ------------------------------------------------------------
    const gaitBefore = gaitPhase.current;
    gaitPhase.current += (speed.current / WALK_SPEED) * dt * 7.0;
    idleClock.current += dt;

    // A footstep on each half-cycle of the gait, which is where a foot is
    // actually down — derived from the same phase that swings the legs rather
    // than from a timer, so the sound cannot drift out of step with the
    // animation however the speed changes. Silent in the air, and silent below
    // a crawl, where the legs are barely moving.
    if (grounded.current && Math.abs(speed.current) > WALK_SPEED * 0.25) {
      if (Math.floor(gaitBefore / Math.PI) !== Math.floor(gaitPhase.current / Math.PI)) {
        roomAudio.play('step');
      }
    }

    // The thrusters, as a continuous voice tracking the throttle the flight
    // system is already computing. `thrust` is eased, so this needs no
    // smoothing of its own.
    roomAudio.setThrust(grounded.current ? 0 : thrust.current);
    const stride = grounded.current
      ? MathUtils.clamp(Math.abs(speed.current) / WALK_SPEED, 0, 2)
      : 0;
    const swing = Math.sin(gaitPhase.current);
    const lift = Math.max(0, Math.sin(gaitPhase.current + Math.PI / 2));

    const pose = (joint: Object3D | undefined, dx: number, dy = 0, dz = 0) => {
      if (!joint) return;
      const base = rest.get(joint);
      if (!base) return;
      joint.rotation.set(base.x + dx, base.y + dy, base.z + dz);
    };

    const breathe = Math.sin(idleClock.current * 1.7) * 0.02;
    const wander =
      Math.sin(idleClock.current * 0.35) * 0.4 + Math.sin(idleClock.current * 0.13) * 0.25;

    pose(joints.hipL, swing * GAIT.hip * stride);
    pose(joints.hipR, -swing * GAIT.hip * stride);
    pose(joints.kneeL, Math.max(0, -swing) * GAIT.knee * stride);
    pose(joints.kneeR, Math.max(0, swing) * GAIT.knee * stride);
    pose(joints.footL, -Math.max(0, -swing) * 0.4 * stride);
    pose(joints.footR, -Math.max(0, swing) * 0.4 * stride);
    pose(joints.shoulderL, -swing * GAIT.arm * stride + breathe);
    pose(joints.shoulderR, swing * GAIT.arm * stride + breathe);
    pose(joints.hips, GAIT.lean * stride * 0.5 + breathe * 0.4);
    if (joints.hips) {
      joints.hips.position.y = 0.04 + lift * GAIT.bob * stride + breathe * 0.001;
    }

    // --- the flight pose --------------------------------------------------
    // A hovering machine hangs from its thrusters: legs trail and part for
    // stability, arms come out and away, and the whole body pitches into
    // the direction of travel. The pitch is the tell that separates flying
    // from being lifted — a body that stays upright while moving is on a
    // wire, and one that leans is driving.
    if (!grounded.current) {
      const rising = MathUtils.clamp(verticalSpeed.current / RISE_CLAMP, -1, 1);
      const hang = MathUtils.clamp(1 - thrust.current * 0.45, 0.35, 1);
      pose(joints.hipL, -0.34 * hang - 0.1 * rising);
      pose(joints.hipR, -0.26 * hang - 0.08 * rising);
      pose(joints.kneeL, 0.62 * hang);
      pose(joints.kneeR, 0.46 * hang);
      pose(joints.footL, -0.5 * thrust.current - 0.15);
      pose(joints.footR, -0.5 * thrust.current - 0.15);
      pose(joints.shoulderL, -0.95 - 0.35 * thrust.current, 0, -0.5 * thrust.current);
      pose(joints.shoulderR, -0.95 - 0.35 * thrust.current, 0, 0.5 * thrust.current);
      pose(joints.hips, -0.12 * rising);
    }
    if (landing.current > 0 && grounded.current) {
      const squash = landing.current / 0.24;
      pose(joints.kneeL, 0.95 * squash);
      pose(joints.kneeR, 0.95 * squash);
      pose(joints.hips, 0.32 * squash);
      if (joints.hips) joints.hips.position.y = 0.04 - 0.006 * squash;
    }

    // Body lean: into the run on the ground, into the flight path in the
    // air, eased so the two blend through each other.
    const wantTilt = grounded.current
      ? MathUtils.clamp(speed.current / RUN_SPEED, -1, 1) * 0.07
      : MathUtils.clamp(speed.current / (RUN_SPEED * AIR_CONTROL), -1, 1) * 0.3;
    tilt.current += (wantTilt - tilt.current) * (1 - Math.exp(-6 * dt));

    // --- the exhaust ------------------------------------------------------
    // Flame length follows thrust with a fast flicker on top; the light
    // follows the same curve so the pool on the floor pulses with it.
    const flicker =
      0.82 + Math.sin(idleClock.current * 61) * 0.1 + Math.sin(idleClock.current * 37) * 0.08;
    for (const flame of exhaust.flames) {
      const visible = thrust.current > 0.02;
      flame.core.visible = visible;
      flame.plume.visible = visible;
      if (!visible) continue;
      const length = thrust.current * flicker;
      flame.core.scale.set(0.7 + thrust.current * 0.4, length * 1.05, 0.7 + thrust.current * 0.4);
      flame.plume.scale.set(0.6 + thrust.current * 0.5, length, 0.6 + thrust.current * 0.5);
      (flame.core.material as MeshBasicMaterial).opacity = 0.55 + thrust.current * 0.4;
      (flame.plume.material as MeshBasicMaterial).opacity = 0.18 + thrust.current * 0.34;
    }
    exhaust.light.intensity = thrust.current * flicker * 0.9;

    // --- the head ---------------------------------------------------------
    // The head takes the view angles filtered through a neck's range, and
    // the torso quietly absorbs whatever is left over — so looking hard
    // left turns the shoulders a little rather than spinning the skull.
    const split = splitLook();
    let wantYaw = controlled ? split.headYaw : wander;
    let wantPitch = controlled ? -split.headPitch : 0;
    if (!grounded.current && Math.abs(pointer.current.y) < 0.25) {
      // Flying, the head leads the climb and watches the ground come up.
      wantPitch = MathUtils.clamp(-verticalSpeed.current * 0.75, -0.5, 0.6);
    } else if (
      grounded.current &&
      lookTarget.current &&
      Math.hypot(pointer.current.x, pointer.current.y) < 0.25
    ) {
      const dx = lookTarget.current.x - position.current.x;
      const dz = lookTarget.current.z - position.current.z;
      const flat = Math.hypot(dx, dz);
      let toward = Math.atan2(dx, dz) - heading.current;
      while (toward > Math.PI) toward -= Math.PI * 2;
      while (toward < -Math.PI) toward += Math.PI * 2;
      wantYaw = MathUtils.clamp(toward, -1.0, 1.0);
      wantPitch = MathUtils.clamp(
        -Math.atan2(lookTarget.current.y - (position.current.y + 0.11), Math.max(flat, 0.05)),
        -0.6,
        0.35
      );
    }
    const headK = 1 - Math.exp(-5 * dt);
    headYaw.current += (wantYaw - headYaw.current) * headK;
    headPitch.current += (wantPitch - headPitch.current) * headK;
    pose(joints.head, -GAIT.lean * stride * 0.3 + headPitch.current, headYaw.current);

    // --- write out -------------------------------------------------------
    group.position.copy(position.current);
    group.rotation.set(tilt.current, heading.current + (controlled ? split.bodyYaw : 0), 0, 'YXZ');
    characterState.position.copy(position.current);
    characterState.heading = heading.current;
    characterState.airborne = !grounded.current;
    characterState.fuel = fuel.current / FUEL_MAX;

    bodyRef.current?.setNextKinematicTranslation({
      x: position.current.x,
      y: position.current.y + 0.06,
      z: position.current.z,
    });

    // --- proximity -------------------------------------------------------
    // Height-gated: the CV on the desk is only readable from the desk. The
    // room's objects stopped being a menu and became places.
    if (controlled && !focused && grounded.current) {
      let best: ObjectId | null = null;
      let bestAt: Vector3 | null = null;
      let bestDistance = REACH;
      for (const item of interactables) {
        if (Math.abs(item.at.y - position.current.y) > REACH_HEIGHT) continue;
        const dx = item.at.x - position.current.x;
        const dz = item.at.z - position.current.z;
        const distance = Math.hypot(dx, dz);
        if (distance < bestDistance) {
          best = item.id;
          bestAt = item.at;
          bestDistance = distance;
        }
      }
      lookTarget.current = bestAt;
      if (best !== nearby) setNearby(best);

      // The guitar leans on the floor, so its reach is generous and flat:
      // anywhere a robot could plausibly stand and strum counts.
      if (guitarAt) {
        const near =
          Math.hypot(guitarAt.x - position.current.x, guitarAt.z - position.current.z) < 0.5 &&
          Math.abs(position.current.y - FLOOR_Y) < 0.2;
        setNearGuitar(near);
      }
    } else {
      lookTarget.current = null;
      if (nearby) setNearby(null);
      setNearGuitar(false);
    }
  });

  return (
    <>
      <group ref={groupRef} position={HOME.toArray()}>
        <primitive object={gltf.scene} />
        {exhaust.objects.map((object, index) => (
          <primitive key={index} object={object} />
        ))}
      </group>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={[HOME.x, HOME.y + 0.06, HOME.z]}
      >
        <CapsuleCollider args={[0.03, 0.024]} />
      </RigidBody>
    </>
  );
}

useGLTF.preload('/models/character.glb');
