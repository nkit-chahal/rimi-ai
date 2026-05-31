import React, { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture, Environment } from '@react-three/drei';
import * as THREE from 'three';

/* ── Garment Shape: T-Shirt ── */
function TShirt({ texture }) {
  return (
    <group>
      {/* Body */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.9, 1.05, 2.2, 32, 1, true]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} metalness={0.0} />
      </mesh>
      {/* Left sleeve */}
      <mesh position={[-1.15, 0.55, 0]} rotation={[0, 0, Math.PI / 3.5]}>
        <cylinderGeometry args={[0.25, 0.38, 0.9, 16, 1, true]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} metalness={0.0} />
      </mesh>
      {/* Right sleeve */}
      <mesh position={[1.15, 0.55, 0]} rotation={[0, 0, -Math.PI / 3.5]}>
        <cylinderGeometry args={[0.25, 0.38, 0.9, 16, 1, true]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.8} metalness={0.0} />
      </mesh>
      {/* Collar ring */}
      <mesh position={[0, 1.1, 0]}>
        <torusGeometry args={[0.35, 0.06, 8, 32]} />
        <meshStandardMaterial color="#333" roughness={0.6} />
      </mesh>
    </group>
  );
}

/* ── Garment Shape: Dress ── */
function Dress({ texture }) {
  return (
    <group>
      {/* Upper body (fitted) */}
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.55, 0.75, 1.4, 32, 1, true]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.7} metalness={0.0} />
      </mesh>
      {/* Skirt (flared) */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.75, 1.3, 1.8, 32, 1, true]} />
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.7} metalness={0.0} />
      </mesh>
      {/* Left strap */}
      <mesh position={[-0.3, 1.6, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.08]} />
        <meshStandardMaterial map={texture} roughness={0.7} />
      </mesh>
      {/* Right strap */}
      <mesh position={[0.3, 1.6, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.08]} />
        <meshStandardMaterial map={texture} roughness={0.7} />
      </mesh>
    </group>
  );
}

/* ── Garment Shape: Tote Bag ── */
function ToteBag({ texture }) {
  return (
    <group>
      {/* Bag body */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.6, 1.8, 0.5]} />
        <meshStandardMaterial map={texture} roughness={0.85} metalness={0.0} />
      </mesh>
      {/* Left handle */}
      <mesh position={[-0.4, 1.3, 0]}>
        <torusGeometry args={[0.35, 0.04, 8, 24, Math.PI]} />
        <meshStandardMaterial color="#555" roughness={0.5} />
      </mesh>
      {/* Right handle */}
      <mesh position={[0.4, 1.3, 0]}>
        <torusGeometry args={[0.35, 0.04, 8, 24, Math.PI]} />
        <meshStandardMaterial color="#555" roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ── Auto-rotate wrapper ── */
function AutoRotate({ enabled, children }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (enabled && ref.current) {
      ref.current.rotation.y += delta * 0.5;
    }
  });
  return <group ref={ref}>{children}</group>;
}

/* ── Textured Garment (applies pattern texture) ── */
function TexturedGarment({ patternUrl, garmentType, tileX, tileY, autoRotate }) {
  const texture = useTexture(patternUrl);

  useEffect(() => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(tileX, tileY);
    texture.needsUpdate = true;
  }, [texture, tileX, tileY]);

  const GarmentComponent = garmentType === 'dress' ? Dress : garmentType === 'totebag' ? ToteBag : TShirt;

  return (
    <AutoRotate enabled={autoRotate}>
      <GarmentComponent texture={texture} />
    </AutoRotate>
  );
}

/* ── Main Export ── */
export default function GarmentPreview3D({ patternUrl, garmentType = 'tshirt', tileX = 4, tileY = 4, autoRotate = true }) {
  if (!patternUrl) return null;

  return (
    <Canvas
      frameloop="always"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.5, 4], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', borderRadius: '12px' }}
    >
      <color attach="background" args={['#1a1a2e']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />
      <directionalLight position={[-3, 3, -3]} intensity={0.4} />

      <Suspense fallback={null}>
        <TexturedGarment
          patternUrl={patternUrl}
          garmentType={garmentType}
          tileX={tileX}
          tileY={tileY}
          autoRotate={autoRotate}
        />
      </Suspense>

      <OrbitControls
        enableZoom={true}
        enablePan={false}
        minDistance={2.5}
        maxDistance={6}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 1.5}
      />
    </Canvas>
  );
}
