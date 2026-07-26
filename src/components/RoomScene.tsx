import { useEffect, useRef, useState } from 'react';
import type { Experience } from '@/three/experience';
import type { SceneQuality } from '@/lib/webgl';
import { projects } from '@/data/projects';
import { stats } from '@/data/stats';
import { profile } from '@/data/profile';

const projectTitles = projects.map((project) => project.title);

const terminalLines: readonly string[] = [
  '$ whoami',
  'mohammad-sharafi',
  '',
  '$ cat focus.txt',
  'digital health · mobile · applied AI',
  '',
  '$ ./metrics --verify',
  ...stats.map((stat) => `✓ ${stat.prefix ?? ''}${stat.value}${stat.suffix} ${stat.label}`),
  '',
  '$ status',
  profile.availability.toLowerCase(),
];

interface RoomSceneProps {
  /** 0 → 1 as the visitor scrolls the hero. */
  progress: number;
  reducedMotion: boolean;
  quality: SceneQuality;
  onReady?: () => void;
}

/**
 * Mounts the Three.js room. Kept as a leaf component behind React.lazy so the
 * whole 3D chunk stays out of the initial bundle.
 */
export default function RoomScene({ progress, reducedMotion, quality, onReady }: RoomSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const experienceRef = useRef<Experience | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let experience: Experience | null = null;

    import('@/three/experience')
      .then(({ createExperience }) => {
        if (disposed) return;
        experience = createExperience({
          canvas,
          projectTitles,
          terminalLines,
          reducedMotion,
          quality,
        });
        experienceRef.current = experience;
        onReady?.();
      })
      .catch(() => {
        // A GPU driver failure should never take the page down with it.
        setFailed(true);
      });

    return () => {
      disposed = true;
      experience?.dispose();
      experienceRef.current = null;
    };
  }, [reducedMotion, quality, onReady]);

  useEffect(() => {
    experienceRef.current?.setProgress(progress);
  }, [progress]);

  if (failed) return null;

  return (
    <canvas
      ref={canvasRef}
      className="size-full"
      // The room is decorative; every fact it shows is also in the DOM below.
      aria-hidden="true"
    />
  );
}
