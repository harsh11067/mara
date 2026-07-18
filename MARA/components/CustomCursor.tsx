'use client';

import { useEffect, useState } from 'react';
import { motion, useSpring } from 'motion/react';

export function CustomCursor() {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPointer, setIsPointer] = useState(false);
  
  const springConfig = { damping: 40, stiffness: 150, mass: 1.5 };
  const cursorX = useSpring(0, springConfig);
  const cursorY = useSpring(0, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);

      const target = e.target as HTMLElement;
      setIsPointer(window.getComputedStyle(target).cursor === 'pointer' || target.tagName.toLowerCase() === 'a' || target.tagName.toLowerCase() === 'button');

      // Magnetic attraction effect for nearby elements
      const magnetics = document.querySelectorAll('[data-magnetic]');
      magnetics.forEach(el => {
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const elX = rect.left + rect.width / 2;
        const elY = rect.top + rect.height / 2;
        
        const dx = e.clientX - elX;
        const dy = e.clientY - elY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Influence radius
        const maxDist = 400;
        
        if (dist < maxDist) {
          const force = (maxDist - dist) / maxDist;
          // Calculate tilt and pull
          const pullX = (dx / maxDist) * 20 * force;
          const pullY = (dy / maxDist) * 20 * force;
          const tiltX = -(dy / maxDist) * 10 * force;
          const tiltY = (dx / maxDist) * 10 * force;
          
          htmlEl.style.transform = `perspective(1000px) translate3d(${pullX}px, ${pullY}px, 0) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
          htmlEl.style.transition = 'none';
        } else {
          htmlEl.style.transform = `perspective(1000px) translate3d(0px, 0px, 0) rotateX(0deg) rotateY(0deg)`;
          htmlEl.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        }
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [cursorX, cursorY]);

  return (
    <>
      <motion.div
        className="fixed top-0 left-0 w-24 h-24 rounded-full pointer-events-none z-[10000] mix-blend-exclusion"
        style={{
          x: cursorX,
          y: cursorY,
          translateX: '-50%',
          translateY: '-50%',
        }}
      >
        <motion.div 
          className="w-full h-full rounded-full bg-white"
          animate={{
            scale: isPointer ? 1.5 : 1,
            opacity: isPointer ? 0.2 : 0.05
          }}
          transition={{ duration: 0.3 }}
        />
      </motion.div>
      <div 
        className="fixed top-0 left-0 w-1 h-1 bg-amber rounded-full pointer-events-none z-[10001] transition-transform duration-100"
        style={{
          transform: `translate3d(${position.x - 2}px, ${position.y - 2}px, 0) scale(${isPointer ? 3 : 1})`,
          opacity: isPointer ? 0 : 1
        }}
      />
    </>
  );
}
