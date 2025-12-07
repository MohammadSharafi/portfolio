import { motion, useMotionValue, useSpring } from 'motion/react';
import { useEffect } from 'react';

export function CursorFollower() {
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  const springConfig = { damping: 30, stiffness: 300 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  useEffect(() => {
    let rafId: number;
    let lastX = 0;
    let lastY = 0;

    const moveCursor = (e: MouseEvent) => {
      // Throttle updates using requestAnimationFrame
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      
      rafId = requestAnimationFrame(() => {
        const deltaX = Math.abs(e.clientX - lastX);
        const deltaY = Math.abs(e.clientY - lastY);
        
        // Only update if movement is significant (reduces updates)
        if (deltaX > 2 || deltaY > 2) {
          cursorX.set(e.clientX - 16);
          cursorY.set(e.clientY - 16);
          lastX = e.clientX;
          lastY = e.clientY;
        }
      });
    };

    window.addEventListener('mousemove', moveCursor, { passive: true });
    return () => {
      window.removeEventListener('mousemove', moveCursor);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cursorX, cursorY]);

  return (
    <>
      {/* Main cursor */}
      <motion.div
        className="fixed w-8 h-8 pointer-events-none z-[9999] mix-blend-difference hidden lg:block will-change-transform"
        style={{
          left: cursorXSpring,
          top: cursorYSpring,
        }}
      >
        <div className="w-full h-full rounded-full border-2 border-white" />
      </motion.div>

      {/* Trailing cursor */}
      <motion.div
        className="fixed w-2 h-2 pointer-events-none z-[9999] mix-blend-difference hidden lg:block will-change-transform"
        style={{
          left: cursorX,
          top: cursorY,
          x: 7,
          y: 7,
        }}
      >
        <div className="w-full h-full rounded-full bg-white" />
      </motion.div>
    </>
  );
}
