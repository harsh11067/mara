'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';

export function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    let lines: Array<{
      x: number; y: number; vx: number; vy: number; length: number; color: string; history: {x: number, y: number}[];
    }> = [];

    const colors = ['#FFB347', '#FF6B4A', '#C8923B', 'rgba(246, 241, 233, 0.1)', 'rgba(255,255,255,0.02)'];

    const init = () => {
      lines = [];
      for (let i = 0; i < 400; i++) {
        lines.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 0,
          vy: 0,
          length: Math.random() * 20 + 10,
          color: colors[Math.floor(Math.random() * colors.length)],
          history: []
        });
      }
    };

    let mouseX = width / 2;
    let mouseY = height / 2;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      init();
    });

    init();

    let animationFrameId: number;
    let time = 0;

    const render = () => {
      ctx.fillStyle = '#090807';
      ctx.fillRect(0, 0, width, height);
      
      time += 0.002;

      ctx.lineWidth = 1;
      
      lines.forEach(p => {
        // Flow field using trig
        const angle = Math.sin(p.x * 0.002 + time) * Math.cos(p.y * 0.002 + time) * Math.PI * 2;
        
        p.vx += Math.cos(angle) * 0.1;
        p.vy += Math.sin(angle) * 0.1;

        // Mouse magnetic effect
        const dx = mouseX - p.x;
        const dy = mouseY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 400) {
          const force = (400 - dist) / 400;
          p.vx += (dx / dist) * force * 0.5;
          p.vy += (dy / dist) * force * 0.5;
        }

        p.vx *= 0.92; // Friction
        p.vy *= 0.92;

        p.x += p.vx;
        p.y += p.vy;
        
        p.history.push({x: p.x, y: p.y});
        if (p.history.length > p.length) {
          p.history.shift();
        }

        // Wrap around screen
        if (p.x < 0) { p.x = width; p.history = []; }
        if (p.x > width) { p.x = 0; p.history = []; }
        if (p.y < 0) { p.y = height; p.history = []; }
        if (p.y > height) { p.y = 0; p.history = []; }

        if (p.history.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.history[0].x, p.history[0].y);
          for (let i = 1; i < p.history.length; i++) {
            ctx.lineTo(p.history[i].x, p.history[i].y);
          }
          ctx.strokeStyle = p.color;
          ctx.stroke();
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 4, ease: "easeOut" }}
      className="absolute inset-0 pointer-events-none z-0 mix-blend-screen"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </motion.div>
  );
}
