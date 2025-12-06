import { motion, useMotionValue, useSpring } from 'motion/react';
import { useEffect } from 'react';

export function CursorFollower() {
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  const springConfig = { damping: 25, stiffness: 200 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  useEffect(() => {
    const moveCursor = (e: MouseEvent) => {
      cursorX.set(e.clientX - 16);
      cursorY.set(e.clientY - 16);
    };

    window.addEventListener('mousemove', moveCursor);
    return () => window.removeEventListener('mousemove', moveCursor);
  }, [cursorX, cursorY]);

  return (
    <>
      {/* Main cursor */}
      <motion.div
        className="fixed w-8 h-8 pointer-events-none z-[9999] mix-blend-difference hidden lg:block"
        style={{
          left: cursorXSpring,
          top: cursorYSpring,
        }}
      >
        <div className="w-full h-full rounded-full border-2 border-white" />
      </motion.div>

      {/* Trailing cursor */}
      <motion.div
        className="fixed w-2 h-2 pointer-events-none z-[9999] mix-blend-difference hidden lg:block"
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
