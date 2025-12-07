import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

export function ParticleBackground() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Detect mobile devices
    const checkMobile = () => {
      const isMobileDevice = window.innerWidth < 768 || 
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(isMobileDevice);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    const generateParticles = () => {
      const newParticles: Particle[] = [];
      // Disable particles on mobile, reduce on desktop
      const particleCount = isMobile ? 0 : 8;
      
      for (let i = 0; i < particleCount; i++) {
        newParticles.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 2 + 1,
          duration: Math.random() * 12 + 6,
          delay: Math.random() * 2,
        });
      }
      setParticles(newParticles);
    };

    generateParticles();
    return () => window.removeEventListener('resize', checkMobile);
  }, [isMobile]);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10 opacity-30">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className="absolute rounded-full bg-gradient-to-r from-primary to-accent blur-sm will-change-transform"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
          }}
          animate={{
            y: [0, -80, 0],
            x: [0, Math.random() * 30 - 15, 0],
            opacity: [0.1, 0.5, 0.1],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Infinity,
            ease: [0.4, 0, 0.6, 1],
            // Use GPU acceleration
            type: 'tween',
          }}
        />
      ))}
    </div>
  );
}
