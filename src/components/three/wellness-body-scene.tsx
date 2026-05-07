'use client';

import { Suspense } from 'react';
import { OrbitControls, Sparkles, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { HealthParticles } from './health-particles';

const SVG_WIDTH = 1264;
const SVG_HEIGHT = 848;
const ASPECT = SVG_WIDTH / SVG_HEIGHT;
/** Base silhouette width in scene units (2× previous 2.5). */
const PLANE_WIDTH = 5;

function getAccentColor(score: number) {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#3b82f6';
  if (score >= 40) return '#f59e0b';
  return '#ec4899';
}

function getSecondaryAccent(score: number) {
  if (score >= 80) return '#6ee7b7';
  if (score >= 60) return '#93c5fd';
  if (score >= 40) return '#fde047';
  return '#fbcfe8';
}

function HumanSilhouettePlane() {
  const texture = useTexture('/huamn.svg');

  const height = PLANE_WIDTH / ASPECT;

  return (
    <mesh position={[0, 0, 0]}>
      <planeGeometry args={[PLANE_WIDTH, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

interface WellnessBodySceneProps {
  /** Average wellness score (0–100) for particle and sparkle tint. */
  averageScore?: number;
}

export function WellnessBodyScene({ averageScore = 65 }: WellnessBodySceneProps) {
  const score = Number.isFinite(averageScore)
    ? Math.min(100, Math.max(0, averageScore))
    : 65;

  const primary = getAccentColor(score);
  const secondary = getSecondaryAccent(score);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 8]} intensity={1.2} color={secondary} />
      <pointLight position={[-4, -2, 6]} intensity={0.8} color={primary} />

      <group position={[0, 0, 0]}>
        <Suspense fallback={null}>
          <HumanSilhouettePlane />
        </Suspense>
        <Sparkles
          count={260}
          scale={8.4}
          size={3.5}
          speed={0.55}
          color={primary}
          opacity={0.92}
        />
        <Sparkles
          count={120}
          scale={6.8}
          size={2.2}
          speed={0.35}
          color={secondary}
          opacity={0.55}
        />
        <HealthParticles
          count={140}
          radiusMin={2.4}
          radiusMax={4.1}
          scale={1}
          color={primary}
        />
      </group>

      <OrbitControls
        target={[0, 0, 0]}
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.55}
        maxPolarAngle={Math.PI / 1.85}
        minPolarAngle={Math.PI / 2.65}
      />
    </>
  );
}
