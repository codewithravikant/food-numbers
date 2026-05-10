'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';

interface ThreeCanvasProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
  /** Override default camera (e.g. pull back when scene content is scaled up). */
  camera?: { position: [number, number, number]; fov?: number };
}

function DefaultFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-32 w-32 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 animate-pulse-soft" />
    </div>
  );
}

const defaultCamera = { position: [0, 0, 5] as [number, number, number], fov: 45 };

export function ThreeCanvas({ children, fallback, className, camera }: ThreeCanvasProps) {
  const cam = {
    position: camera?.position ?? defaultCamera.position,
    fov: camera?.fov ?? defaultCamera.fov,
  };
  return (
    <div className={className}>
      <Suspense fallback={fallback || <DefaultFallback />}>
        <Canvas
          camera={cam}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
          onCreated={({ gl }) => {
            const el = gl.domElement;
            el.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
            });
          }}
        >
          {children}
        </Canvas>
      </Suspense>
    </div>
  );
}
