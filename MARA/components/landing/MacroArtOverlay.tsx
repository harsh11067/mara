'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export function MacroArtOverlay() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Extend bounds so lines go off-screen
    const extWidth = width * 1.2;
    const extHeight = height * 1.2;
    const offsetX = -width * 0.1;
    const offsetY = -height * 0.1;

    const svg = d3.select(containerRef.current)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('position', 'absolute')
      .style('top', '0')
      .style('left', '0')
      .style('pointer-events', 'none')
      .style('mix-blend-mode', 'screen');

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'metallic-flow')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '100%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#C8923B').attr('stop-opacity', 0.1);
    gradient.append('stop').attr('offset', '50%').attr('stop-color', '#FFB347').attr('stop-opacity', 0.3);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#FF6B4A').attr('stop-opacity', 0.1);

    const numLines = 70;
    const pointsPerLine = 100;

    const lineGen = d3.line<[number, number]>()
      .x(d => d[0])
      .y(d => d[1])
      .curve(d3.curveBasis);

    const linesData: [number, number][][] = [];
    for (let i = 0; i < numLines; i++) {
      const line: [number, number][] = [];
      for (let j = 0; j <= pointsPerLine; j++) {
        line.push([offsetX + j * (extWidth / pointsPerLine), offsetY + i * (extHeight / numLines)]);
      }
      linesData.push(line);
    }

    const paths = svg.selectAll('path')
      .data(linesData)
      .enter()
      .append('path')
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', 'url(#metallic-flow)')
      .attr('stroke-width', 1)
      .style('opacity', 0.8)
      .style('transform-origin', 'center');

    let mouseX = width / 2;
    let mouseY = height / 2;
    let targetMouseX = width / 2;
    let targetMouseY = height / 2;
    let time = 0;

    const onMouseMove = (e: MouseEvent) => {
      targetMouseX = e.clientX;
      targetMouseY = e.clientY;
    };
    window.addEventListener('mousemove', onMouseMove);

    let animationFrameId: number;

    const render = () => {
      time += 0.005;
      
      // Interpolate mouse for smooth physical feel
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      paths.attr('d', (d, i) => {
        const newData = d.map((p, j) => {
          const basePathX = offsetX + j * (extWidth / pointsPerLine);
          const basePathY = offsetY + i * (extHeight / numLines);
          
          const dx = mouseX - basePathX;
          const dy = mouseY - basePathY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          const influence = Math.max(0, 400 - dist) / 400;
          
          // Complex guilloche-like math
          const phase1 = time * 2 + (j * 0.1) + (i * 0.1);
          const phase2 = time * -1.5 + (j * 0.05) - (i * 0.08);
          
          const warpX = Math.sin(phase1) * 30 * Math.cos(phase2) + Math.sin(time + i * 0.1) * 20;
          const warpY = Math.cos(phase1) * 30 * Math.sin(phase2) + Math.cos(time + j * 0.1) * 20;
          
          return [
            basePathX + warpX - (dx * Math.pow(influence, 2) * 0.4), 
            basePathY + warpY - (dy * Math.pow(influence, 2) * 0.4)
          ] as [number, number];
        });
        return lineGen(newData);
      });

      animationFrameId = requestAnimationFrame(render);
    };
    
    render();

    const onResize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;
      svg.attr('width', newWidth).attr('height', newHeight);
      // We could regenerate paths here, but for now just updating svg size helps
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animationFrameId);
      svg.remove();
    };
  }, []);

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-0" />;
}
