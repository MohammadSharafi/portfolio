import { useCallback, useEffect, useRef, useState } from 'react';
import { detectQuality, supportsWebGL, type SceneQuality } from '@/lib/webgl';

interface UseRoomResult {
  /** Whether the 3D room should mount at all. */
  showRoom: boolean;
  quality: SceneQuality;
  /** 0 → 1 across the scroll range that choreographs the camera. */
  progress: number;
  roomReady: boolean;
  onRoomReady: () => void;
  /** Attach to the tall hero wrapper that the sticky scene pins inside. */
  sceneRef: React.RefObject<HTMLElement>;
}

export function useRoom(): UseRoomResult {
  // Decided once on mount: the check touches the GPU and must not run per render.
  const [showRoom, setShowRoom] = useState(false);
  const [quality, setQuality] = useState<SceneQuality>('high');
  const [progress, setProgress] = useState(0);
  const [roomReady, setRoomReady] = useState(false);
  const sceneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!supportsWebGL()) return;
    setShowRoom(true);
    setQuality(detectQuality());
  }, []);

  useEffect(() => {
    if (!showRoom) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = sceneRef.current;
      if (!el) return;

      // Progress across the pinned range: from the wrapper's top reaching the
      // viewport top, to its bottom doing the same.
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) {
        setProgress(0);
        return;
      }
      setProgress(Math.min(1, Math.max(0, -rect.top / travel)));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [showRoom]);

  const onRoomReady = useCallback(() => setRoomReady(true), []);

  return { showRoom, quality, progress, roomReady, onRoomReady, sceneRef };
}
