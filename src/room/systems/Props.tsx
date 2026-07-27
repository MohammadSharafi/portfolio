import { useMemo } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { Mesh, Vector3, type Object3D } from 'three';

/**
 * The loose objects on the desk, handed over to Rapier.
 *
 * They ship inside the same GLB as everything else, so they are lifted out of
 * the static scene and re-parented into rigid bodies at the world transform
 * they were exported with. Cloning them instead would leave a ghost copy welded
 * to the desk, sitting inside whichever body the visitor just knocked over.
 *
 * Only things that would actually move in a real room are dynamic. A physics
 * body per object is both a solver cost and a way for the room to end up in a
 * state nobody designed — a bookshelf that can be pushed over is a bug, not a
 * feature.
 */
const DYNAMIC: Record<string, { mass: number; restitution: number; friction: number }> = {
  ix_mug: { mass: 0.32, restitution: 0.18, friction: 0.7 },
  ix_pencil: { mass: 0.01, restitution: 0.3, friction: 0.35 },
  ix_mouse: { mass: 0.09, restitution: 0.12, friction: 0.6 },
};

interface Prop {
  id: string;
  mesh: Mesh;
  position: [number, number, number];
  config: (typeof DYNAMIC)[string];
}

export function Props({ root }: { root: Object3D }) {
  const props = useMemo<Prop[]>(() => {
    const found: Prop[] = [];
    const world = new Vector3();

    // Collected first, detached second: mutating the graph mid-traverse skips
    // siblings.
    const candidates: Array<[string, Mesh]> = [];
    root.traverse((node) => {
      if (node instanceof Mesh && DYNAMIC[node.name]) candidates.push([node.name, node]);
    });

    for (const [id, mesh] of candidates) {
      mesh.getWorldPosition(world);
      mesh.removeFromParent();
      // The body owns the transform now, so the mesh sits at its own origin.
      mesh.position.set(0, 0, 0);
      found.push({
        id,
        mesh,
        position: [world.x, world.y, world.z],
        config: DYNAMIC[id]!,
      });
    }

    return found;
  }, [root]);

  return (
    <>
      {props.map((prop) => (
        <RigidBody
          key={prop.id}
          colliders="hull"
          position={prop.position}
          mass={prop.config.mass}
          restitution={prop.config.restitution}
          friction={prop.config.friction}
          // Props settle and then stop costing anything until touched again.
          canSleep
        >
          <primitive object={prop.mesh} />
        </RigidBody>
      ))}

      {/* The world the props fall onto: the desk top, and the floor under it.
        Trimeshing the whole room would cost far more than two boxes for a
        surface nothing ever sees the far side of. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[1.75, 0.035, 0.65]} position={[0, 0.755, 1.85]} />
        <CuboidCollider args={[6, 0.05, 6]} position={[0, -0.05, 0]} />
      </RigidBody>
    </>
  );
}
