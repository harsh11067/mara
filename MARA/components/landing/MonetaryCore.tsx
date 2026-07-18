'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Environment, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

function CoreMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.2;
      meshRef.current.rotation.x = Math.sin(state.clock.getElapsedTime() * 0.4) * 0.2;
    }
  });

  return (
    <Float speed={3} rotationIntensity={2} floatIntensity={3}>
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[2.5, 64]} />
        <MeshDistortMaterial 
          color="#FFB347"
          emissive="#C8923B"
          emissiveIntensity={0.5}
          roughness={0.1}
          metalness={1}
          distort={0.5}
          speed={2}
          clearcoat={1}
          clearcoatRoughness={0.1}
          wireframe={true}
        />
      </mesh>
    </Float>
  );
}

function OrbitingRings() {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.z = state.clock.getElapsedTime() * 0.1;
      groupRef.current.rotation.x = Math.cos(state.clock.getElapsedTime() * 0.2) * 0.3;
    }
  });

  return (
    <group ref={groupRef}>
      {[...Array(5)].map((_, i) => (
        <mesh key={i} rotation={[Math.PI / 2 + (i * 0.15), 0, 0]}>
          <torusGeometry args={[3.5 + i * 0.6, 0.02, 16, 100]} />
          <meshPhysicalMaterial 
            color="#FF6B4A"
            emissive="#FFB347"
            emissiveIntensity={1 + i * 0.5}
            transparent
            opacity={0.6}
            roughness={0}
            metalness={1}
          />
        </mesh>
      ))}
    </group>
  );
}

export function MonetaryCore() {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
      <Canvas camera={{ position: [0, 0, 10], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={2} color="#FFB347" />
        <pointLight position={[-10, -10, -5]} intensity={1} color="#C8923B" />
        
        <CoreMesh />
        <OrbitingRings />
        
        <Sparkles count={300} scale={15} size={3} speed={0.6} opacity={0.4} color="#FFB347" />
        
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}
