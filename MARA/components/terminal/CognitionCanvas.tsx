'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/** A live cognition item — real agent trace steps / decisions, never scripted. */
export interface CognitionItem {
  id: string;
  node: string;      // e.g. "TRACE 03 · query_macro_corpus" or "DECISION a1b2c3d4"
  text: string;
  conf: string;      // right-hand tag, e.g. "82%" or "TOOL"
  type: 'warn' | 'info' | 'alert';
}

export function CognitionCanvas({ items }: { items: CognitionItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeEvents: CognitionItem[] = items.length > 0 ? items.slice(0, 4) : [{
    id: 'idle',
    node: 'PIPELINE · IDLE',
    text: 'Listening on the live WebSocket. When a macro print fires — or you trigger one — the agent\'s reasoning steps stream here in real time.',
    conf: 'LIVE',
    type: 'info',
  }];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    let particles: {x: number, y: number, vx: number, vy: number, life: number, maxLife: number, color: string, size: number, history: {x: number, y: number}[]}[] = [];
    let animationFrame: number;
    let time = 0;
    
    const colors = ['#FFB347', '#FF6B4A', '#C8923B', 'rgba(246, 241, 233, 0.4)'];
    
    const render = () => {
      ctx.fillStyle = 'rgba(9, 8, 7, 0.1)'; // Dark background with longer trails
      ctx.fillRect(0, 0, width, height);
      
      time += 0.005;
      
      // Spawn inputs from the left
      if (Math.random() < 0.6) {
        particles.push({
          x: -10,
          y: (height / 2) + (Math.random() - 0.5) * height * 0.8,
          vx: Math.random() * 2 + 1,
          vy: 0,
          life: 0,
          maxLife: 200 + Math.random() * 200,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 0.5 + 0.5,
          history: []
        });
      }
      
      ctx.globalCompositeOperation = 'screen';
      
      particles.forEach(p => {
        // Flow field & Bifurcation math
        const angle = Math.sin(p.x * 0.01 + time) * Math.cos(p.y * 0.01 + time) * Math.PI;
        
        // At certain points, bifurcate (split forces)
        const bifurcateZone = (Math.floor(p.x / 100) % 2 === 0);
        
        p.vx += Math.cos(angle) * (bifurcateZone ? 0.2 : 0.05);
        p.vy += Math.sin(angle) * (bifurcateZone ? 0.3 : 0.05);
        
        // Attract towards center-right (Decision convergence)
        const targetX = width;
        const targetY = height / 2;
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        p.vx += (dx / dist) * 0.15;
        p.vy += (dy / dist) * 0.15;
        
        p.vx *= 0.94; // friction
        p.vy *= 0.94;
        
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        
        p.history.push({x: p.x, y: p.y});
        if (p.history.length > 20) p.history.shift();
        
        const alpha = Math.max(0, 1 - (p.life / p.maxLife));
        
        // Draw fine trail
        if (p.history.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.history[0].x, p.history[0].y);
          for (let i = 1; i < p.history.length; i++) {
            ctx.lineTo(p.history[i].x, p.history[i].y);
          }
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.globalAlpha = alpha * 0.6;
          ctx.stroke();
        }
        
        // Draw particle head
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      
      particles = particles.filter(p => p.life < p.maxLife && p.x < width + 10);
      
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
    <div className="relative w-full h-[500px] border border-foreground/5 bg-background overflow-hidden group">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      
      <div className="absolute inset-0 flex flex-col justify-around p-8 pointer-events-none z-10">
        <AnimatePresence mode="popLayout">
          {activeEvents.map((evt) => (
            <motion.div 
              key={evt.id}
              layout
              initial={{ opacity: 0, x: -30, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.95 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="w-5/6 bg-[#161412]/60 backdrop-blur-md border border-[#F6F1E9]/10 p-5 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-[2px] h-full bg-gradient-to-b from-amber to-coral opacity-50" />
              <div className="flex justify-between items-start mb-3">
                <span className="text-[10px] font-mono text-muted tracking-widest">{evt.node}</span>
                <span className={`text-[10px] font-mono ${evt.type === 'warn' ? 'text-amber' : evt.type === 'alert' ? 'text-coral' : 'text-muted'}`}>{evt.conf}</span>
              </div>
              <p className="text-sm font-sans leading-relaxed text-foreground font-light">
                {evt.text}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      
      <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-[#090807] via-transparent to-transparent pointer-events-none z-20" />
    </div>
  );
}
