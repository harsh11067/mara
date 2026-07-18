'use client';

import { useEnvironment } from '@/components/context/EnvironmentContext';
import { motion } from 'motion/react';

export function BackgroundFX() {
  const { volatility } = useEnvironment();

  return (
    <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden bg-background">
      {/* Noise - with dynamic mix-blend and opacity from design */}
      <motion.div 
        className="absolute inset-0 pointer-events-none mix-blend-overlay" 
        animate={{ opacity: 0.05 + (volatility * 0.15) }}
        transition={{ duration: 3, ease: "linear" }}
        style={{
          backgroundImage: 'url(\'data:image/svg+xml,%3Csvg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noise"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23noise)"/%3E%3C/svg%3E\')'
        }}
      />
      
      {/* Soft Ambient Gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#161413] via-background to-black opacity-60" />
      
      {/* Specific top light from design */}
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-amber blur-[160px] opacity-10 rounded-full" />
    </div>
  );
}
