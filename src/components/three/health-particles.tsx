'use client';

import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HealthParticlesProps {
  count?: number;
  /** Inner radius of the particle shell (default matches original look). */
  radiusMin?: number;
  /** Outer radius of the particle shell. */
  radiusMax?: number;
  /** Uniform scale for the whole point cloud. */
  scale?: number;
  color?: string;
}

function createHealthPositions(count: number, radiusMin: number, radiusMax: number) {
  const pos = new Float32Array(count * 3);
  const span = radiusMax - radiusMin;
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = radiusMin + Math.random() * span;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  return pos;
}

export function HealthParticles({
  count = 50,
  radiusMin = 2,
  radiusMax = 3.5,
  scale = 1,
  color = '#34d399',
}: HealthParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const [positions] = useState(() => createHealthPositions(count, radiusMin, radiusMax));

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.002;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.05;
    }
  });

  return (
    <group scale={scale}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.04}
          color={color}
          transparent
          opacity={0.6}
          sizeAttenuation
        />
      </points>
    </group>
  );
}
