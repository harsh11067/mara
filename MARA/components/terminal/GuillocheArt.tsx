'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';

export function GuillocheArt() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    let time = 0;
    let animationFrame: number;
    
    const drawSpirograph = (R: number, r: number, p: number, color: string, timeOffset: number) => {
      ctx.beginPath();
      const maxTheta = Math.PI * 150; 
      for (let theta = 0; theta <= maxTheta; theta += 0.1) {
        const t = theta + timeOffset;
        const x = width / 2 + (R + r) * Math.cos(t) + p * Math.cos((R + r) * t / r);
        const y = height / 2 + (R + r) * Math.sin(t) + p * Math.sin((R + r) * t / r);
        if (theta === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      time += 0.003;
      
      drawSpirograph(200, 52, 140 + Math.sin(time)*40, 'rgba(255, 179, 71, 0.25)', time);
      drawSpirograph(240, -70, 120, 'rgba(246, 241, 233, 0.15)', -time * 0.8);
      drawSpirograph(280, 85, 160 + Math.cos(time)*30, 'rgba(255, 107, 74, 0.15)', time * 1.2);
      drawSpirograph(140, 35, 80, 'rgba(200, 146, 59, 0.25)', -time * 1.5);
      
      animationFrame = requestAnimationFrame(render);
    };
    
    render();
    
    const handleResize = () => {
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none" style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}>
      <motion.div 
        className="w-full h-full"
        animate={{ 
          rotateX: [20, 45, 20], 
          rotateY: [-30, -10, -30],
          rotateZ: [0, 15, 0]
        }}
        transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        <canvas ref={canvasRef} className="w-full h-full mix-blend-screen" />
      </motion.div>
    </div>
  );
}
