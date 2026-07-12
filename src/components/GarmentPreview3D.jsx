import React, { Component, Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { resolveMediaUrl, mediaPathNeedsAuth } from './studio/shared/helpers';

/* ── Local boundary so texture/WebGL failures don't kill Studio ── */
class TextureErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('3D preview failed:', error?.message || error);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function PreviewFallback({ message = 'Could not load pattern for 3D preview.' }) {
  return (
    <div className="st-empty-canvas" style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1rem' }}>{message}</p>
    </div>
  );
}

/** Probe that an image URL is loadable before handing it to Three.js TextureLoader. */
function probeImageUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('empty url'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

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
  useFrame((state, delta) => {
    if (enabled && ref.current) {
      ref.current.rotation.y += delta * 0.5;
      state.invalidate();
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
    texture.colorSpace = THREE.SRGBColorSpace;
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
export default function GarmentPreview3D({
  patternUrl,
  garmentType = 'tshirt',
  tileX = 4,
  tileY = 4,
  autoRotate = true,
  token = null,
}) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const contextLostRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    setResolveFailed(false);
    // Do not clear contextLost here — remounting after a lost context thrashs the GPU.
    // Only reset when the pattern URL / token actually changes and context was not lost.
    if (!contextLostRef.current) {
      setContextLost(false);
    }

    if (!patternUrl) return undefined;
    if (contextLostRef.current) return undefined;

    (async () => {
      try {
        const url = await resolveMediaUrl(patternUrl, token);
        if (cancelled) return;
        if (!url) {
          setResolveFailed(true);
          return;
        }
        if (mediaPathNeedsAuth(patternUrl) && !url.includes('access_token=')) {
          setResolveFailed(true);
          return;
        }
        // Verify the image loads in the browser before Three.js TextureLoader sees it.
        // Avoids uncaught TextureLoader rejections for 404 / CORS / auth failures.
        await probeImageUrl(url);
        if (cancelled) return;
        setResolvedUrl(url);
      } catch (err) {
        console.warn('Failed to resolve 3D pattern URL:', err?.message || err);
        if (!cancelled) setResolveFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patternUrl, token]);

  if (!patternUrl) return null;
  if (resolveFailed || contextLost) {
    return (
      <PreviewFallback
        message={contextLost
          ? '3D preview paused (graphics context lost). Try switching tools or refreshing.'
          : 'Could not load pattern for 3D preview.'}
      />
    );
  }
  if (!resolvedUrl) {
    return <div className="tool-loading">Loading 3D preview…</div>;
  }

  return (
    <TextureErrorBoundary
      resetKey={resolvedUrl}
      fallback={<PreviewFallback />}
    >
      <Canvas
        frameloop={autoRotate ? 'always' : 'demand'}
        dpr={[1, 1.25]}
        camera={{ position: [0, 0.5, 4], fov: 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
        style={{ width: '100%', height: '100%', borderRadius: '12px' }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          const onLost = (e) => {
            e.preventDefault();
            contextLostRef.current = true;
            setContextLost(true);
            setResolvedUrl(null);
          };
          canvas.addEventListener('webglcontextlost', onLost, false);
        }}
      >
        <color attach="background" args={['#1a1a2e']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-3, 3, -3]} intensity={0.4} />

        <Suspense fallback={null}>
          <TexturedGarment
            patternUrl={resolvedUrl}
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
    </TextureErrorBoundary>
  );
}
