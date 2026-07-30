import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import type { Group } from 'three';
import { MathUtils, Vector3, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { characterState } from '../engine/characterState';
import type { ObjectId } from '../data/objects';

/**
 * The desk robot, and the game layer it carries.
 *
 * `build_character.py` made one decision this whole file leans on: the robot
 * is rigid parts hinged at their pivots, not a skinned mesh. That means there
 * are no animation clips to load and none are needed — walking is a phase
 * variable driving joint rotations, and every gait parameter is a number
 * derived from the body itself. The desk at 79 cm stands 6.6 robot-heights
 * tall, which is why the room reads as a city from down on the boards: the
 * desk is a building, the sofa a hillside, the rug a public square.
 *
 * The robot is always present, idling on the floor — a room with an
 * inhabitant reads as alive even for visitors who never touch the controls.
 * "Walk the room" hands it the keyboard, tank-style: W walks the way it
 * faces, A/D turn it, S backs it up. A kinematic Rapier capsule rides along
 * so anything dynamic it barges genuinely shoves aside.
 *
 * Interaction reuses the room's one interface: stand near anything with an
 * `objectId` and a prompt appears; E focuses it, and the same camera stop and
 * panel open as if it had been clicked. The robot is another way of pointing.
 */

/** Where the robot starts: on the floorboards in front of the desk. From
 * down there the desk is a four-storey building and the sofa is a hill —
 * the scale story the whole character was sized for. */
const HOME = new Vector3(0.05, 0.006, 1.3);

/** The floor the robot may roam, minus a skirting-board margin. */
const ROOM_BOUNDS = { minX: -2.7, maxX: 3.0, minZ: -2.3, maxZ: 2.44 };

/** Furniture the robot walks around, as cheap footprints: boxes for the
 * big casework, circles for pedestals and pots. It can still walk *under*
 * the desk, the coffee table and the chair — at 12 cm, undersides are
 * doorways — so only what truly meets the floor blocks it. */
const BOXES = [
  { minX: -0.88, maxX: 1.28, minZ: -2.1, maxZ: -1.1 }, // sofa
  { minX: -2.7, maxX: -2.16, minZ: 1.5, maxZ: 2.44 }, // dresser
  { minX: 0.28, maxX: 0.9, minZ: 1.78, maxZ: 2.44 }, // desk pedestal
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

/** Metres per second, scaled from a human walk by the 0.12 m body. */
const WALK_SPEED = 0.1;
const RUN_SPEED = 0.2;
const BACK_SPEED = 0.055;
const TURN_SPEED = 3.0;

/** How close counts as "standing at" an interactable, in metres. */
const REACH = 0.3;

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

  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<RapierRigidBody>(null);
  const position = useRef(new Vector3().copy(HOME));
  const heading = useRef(Math.PI);
  const speed = useRef(0);
  const gaitPhase = useRef(0);
  const idleClock = useRef(0);

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

  /** Rest pose per joint, so animation is applied around it, never onto it. */
  const rest = useMemo(() => {
    const map = new Map<Object3D, { x: number; y: number; z: number }>();
    for (const joint of Object.values(joints)) {
      if (joint) map.set(joint, { x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z });
    }
    return map;
  }, [joints]);

  /** Every interactable in the room, measured in the ground plane — standing
   * at the shelf's foot counts as standing at the shelf. */
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

  // The keyboard, only while driving and only when no panel is open. E and
  // Escape are handled here rather than in the overlay so the whole mode's
  // input lives in one place.
  useEffect(() => {
    if (!controlled) return;
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(
          key
        )
      ) {
        keys.add(key);
        event.preventDefault();
      }
      if (key === 'e' && !useEngine.getState().focused) {
        const target = useEngine.getState().nearby;
        if (target) focus(target);
      }
      if (key === 'escape' && !useEngine.getState().focused) setControlled(false);
    };
    const up = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.clear();
    };
  }, [controlled, focus, setControlled]);

  useEffect(() => {
    characterState.active = controlled;
  }, [controlled]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const group = groupRef.current;
    if (!group) return;

    // --- input to intent -------------------------------------------------
    // Tank scheme, the way a follow camera wants it: W walks the way the
    // robot faces, S backs it up, A and D turn the body — and because the
    // camera hangs off the heading, turning carries the view with it. The
    // first version was screen-relative, and with the camera behind the
    // character "left" changed meaning every time the shot did.
    let drive = 0;
    let steer = 0;
    if (controlled && !focused) {
      if (keys.has('w') || keys.has('arrowup')) drive += 1;
      if (keys.has('s') || keys.has('arrowdown')) drive -= 1;
      if (keys.has('a') || keys.has('arrowleft')) steer += 1;
      if (keys.has('d') || keys.has('arrowright')) steer -= 1;
    }
    heading.current += steer * TURN_SPEED * dt * (drive < 0 ? -1 : 1);

    const targetSpeed =
      drive > 0 ? (keys.has('shift') ? RUN_SPEED : WALK_SPEED) : drive < 0 ? -BACK_SPEED : 0;
    speed.current += (targetSpeed - speed.current) * (1 - Math.exp(-8 * dt));

    if (Math.abs(speed.current) > 0.001) {
      position.current.x += Math.sin(heading.current) * speed.current * dt;
      position.current.z += Math.cos(heading.current) * speed.current * dt;
    }

    // --- keep it on the floor and out of the furniture -------------------
    position.current.x = MathUtils.clamp(position.current.x, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX);
    position.current.z = MathUtils.clamp(position.current.z, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ);
    for (const box of BOXES) {
      const px = position.current.x;
      const pz = position.current.z;
      if (px > box.minX && px < box.maxX && pz > box.minZ && pz < box.maxZ) {
        const pushLeft = px - box.minX;
        const pushRight = box.maxX - px;
        const pushNear = pz - box.minZ;
        const pushFar = box.maxZ - pz;
        const smallest = Math.min(pushLeft, pushRight, pushNear, pushFar);
        if (smallest === pushLeft) position.current.x = box.minX;
        else if (smallest === pushRight) position.current.x = box.maxX;
        else if (smallest === pushNear) position.current.z = box.minZ;
        else position.current.z = box.maxZ;
      }
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

    // --- gait ------------------------------------------------------------
    // Phase advances with distance, not time: feet plant when the body
    // stops, mid-stride, exactly where they were.
    gaitPhase.current += (speed.current / WALK_SPEED) * dt * 7.0;
    idleClock.current += dt;
    const stride = MathUtils.clamp(Math.abs(speed.current) / WALK_SPEED, 0, 2);
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
    // The torso leans into motion and bobs with the step; idle, it breathes
    // and the head looks slowly around the desk.
    pose(joints.hips, GAIT.lean * stride * 0.5 + breathe * 0.4);
    pose(joints.head, -GAIT.lean * stride * 0.3, controlled ? 0 : wander);
    if (joints.hips) {
      joints.hips.position.y =
        (rest.get(joints.hips) ? 0.04 : 0.04) + lift * GAIT.bob * stride + breathe * 0.001;
    }

    // --- write out -------------------------------------------------------
    group.position.copy(position.current);
    group.rotation.y = heading.current;
    characterState.position.copy(position.current);
    characterState.heading = heading.current;

    // The collision capsule follows kinematically, so dynamic props are
    // shoved rather than passed through. When physics is paused (reduced
    // motion) the robot still walks; the props simply hold their ground.
    bodyRef.current?.setNextKinematicTranslation({
      x: position.current.x,
      y: position.current.y + 0.06,
      z: position.current.z,
    });

    // --- proximity -------------------------------------------------------
    if (controlled && !focused) {
      let best: ObjectId | null = null;
      let bestDistance = REACH;
      for (const item of interactables) {
        const dx = item.at.x - position.current.x;
        const dz = item.at.z - position.current.z;
        const distance = Math.hypot(dx, dz);
        if (distance < bestDistance) {
          best = item.id;
          bestDistance = distance;
        }
      }
      if (best !== nearby) setNearby(best);
    } else if (nearby) {
      setNearby(null);
    }
  });

  return (
    <>
      <group ref={groupRef} position={HOME.toArray()}>
        <primitive object={gltf.scene} />
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
