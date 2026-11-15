"use client";
/* eslint-disable react-hooks/immutability -- three.js objects and pin nodes are mutated every frame inside useFrame, which is how @react-three/fiber is meant to be used */

/**
 * Illustrative commercial building for the landing page (never a real property's geometry).
 * Technique follows HeatHunter's scene: named camera shots flown with damping, a view offset so the
 * subject centres in the space a panel leaves free, a warm key light with a soft sky fill, and fog.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type Shot = "entry" | "intro" | "search" | "parking" | "entrance" | "route" | "selected" | "launch";
type V3 = [number, number, number];

const SHOTS: Record<Shot, { pos: V3; target: V3 }> = {
  entry: { pos: [86, 70, 104], target: [0, 2, 2] },
  intro: { pos: [60, 40, 70], target: [0, 1, 3] },
  search: { pos: [34, 30, 52], target: [-1, 0, 5] },
  parking: { pos: [8, 11, 21], target: [-1.5, 0, 4] },
  entrance: { pos: [-11, 6, 11], target: [0, 2.4, -3] },
  route: { pos: [12, 6.5, 8], target: [-1.2, 0.4, -0.6] },
  selected: { pos: [6, 54, 34], target: [0, 0, 2] },
  launch: { pos: [0.01, 96, 0.6], target: [0, 0, 0.5] },
};

/** World-space anchors for the scene pins; the page renders the pins, the scene positions them. */
export const PIN_ANCHORS: Record<"parking" | "entrance" | "route", V3> = {
  parking: [-4.05, 0.3, 4.6],
  entrance: [0, 3.4, -2.6],
  route: [-1.35, 0.25, -0.6],
};

const BG = "#e7e8e3";

function isaTexture() {
  // International Symbol of Accessibility painted on a blue stall, drawn once to a canvas.
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1450a3"; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = "#f4f4f0"; g.fillStyle = "#f4f4f0"; g.lineWidth = 7; g.lineCap = "round"; g.lineJoin = "round";
  g.save(); g.translate(64, 120);  // upright when read from the drive aisle, as painted
  g.beginPath(); g.arc(-4, -40, 9, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(-6, -26); g.lineTo(-6, 6); g.lineTo(18, 6); g.lineTo(28, 30); g.stroke();
  g.beginPath(); g.moveTo(-6, -12); g.lineTo(14, -12); g.stroke();
  g.beginPath(); g.arc(-6, 14, 22, Math.PI * 0.15, Math.PI * 1.25); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function Box({ size, pos, color, shadow = true, rough = 0.9, metal = 0, rot }: {
  size: V3; pos: V3; color: string; shadow?: boolean; rough?: number; metal?: number; rot?: V3;
}) {
  return (
    <mesh position={pos} rotation={rot} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} />
    </mesh>
  );
}

function Lines({ items, color = "#f1f1ec", y = 0.045 }: { items: { x: number; z: number; w: number; d: number; r?: number }[]; color?: string; y?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.r ?? 0, 0));
      m.compose(new THREE.Vector3(it.x, y, it.z), q, new THREE.Vector3(it.w, 0.02, it.d));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [items, y]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </instancedMesh>
  );
}

function Site() {
  const isa = useMemo(() => isaTexture(), []);
  const stallLines = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number }[] = [];
    for (let i = -9; i <= 9; i++) { out.push({ x: i * 2.7, z: 3.9, w: 0.12, d: 5.4 }); out.push({ x: i * 2.7, z: 18.1, w: 0.12, d: 5.4 }); }
    out.push({ x: 0, z: 11, w: 48.6, d: 0.12 });
    return out;
  }, []);
  // Hatched access aisle between the two accessible stalls.
  const hatch = useMemo(() => Array.from({ length: 7 }, (_, k) => ({ x: -1.35, z: 1.8 + k * 0.78, w: 2.9, d: 0.16, r: -0.62 })), []);
  const trees: [number, number][] = [[-30, -7], [-30, 5], [-30, 17], [30, -7], [30, 5], [30, 17], [-13, 11], [13, 11], [0, 26], [-18, 27], [18, 27]];
  const cars: [number, number, string][] = [[-17.55, 3.9, "#8d969d"], [-12.15, 3.9, "#c9ccc8"], [9.45, 3.9, "#5c6a78"], [17.55, 3.9, "#b8b1a5"],
    [-9.45, 18.1, "#a4abb0"], [4.05, 18.1, "#6f7a72"], [14.85, 18.1, "#d6d4cd"]];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[900, 900]} /><meshStandardMaterial color="#e1e1db" roughness={1} /></mesh>
      <Box size={[54, 0.04, 22.4]} pos={[0, 0.02, 11]} color="#3d444b" shadow={false} rough={0.95} />
      <Box size={[54, 0.18, 4]} pos={[0, 0.09, -2]} color="#d6d5ce" />
      <Box size={[64, 0.12, 2.2]} pos={[0, 0.06, 23.4]} color="#d6d5ce" />
      {/* building */}
      <Box size={[44, 8.5, 14]} pos={[0, 4.25, -11]} color="#efeee9" />
      <Box size={[44.6, 0.7, 14.6]} pos={[0, 8.85, -11]} color="#e3e2dc" />
      {[3.1, 6.4].map((y) => <Box key={y} size={[41.5, 1.7, 0.12]} pos={[0, y, -3.95]} color="#6f8597" rough={0.25} metal={0.35} shadow={false} />)}
      {[3.1, 6.4].map((y) => <Box key={`s${y}`} size={[0.12, 1.7, 12]} pos={[22.02, y, -11]} color="#61778a" rough={0.25} metal={0.35} shadow={false} />)}
      {[-6, 6].map((x) => <Box key={x} size={[0.5, 8.5, 0.5]} pos={[x, 4.25, -3.75]} color="#e3e2dc" />)}
      <Box size={[7, 4.1, 1.4]} pos={[0, 2.05, -3.3]} color="#91a6b6" rough={0.2} metal={0.4} />
      <Box size={[2.1, 2.7, 0.06]} pos={[0, 1.35, -2.57]} color="#2b3239" shadow={false} />
      <Box size={[9.2, 0.38, 2.6]} pos={[0, 4.4, -3.2]} color="#2b3239" />
      <Box size={[4, 1.4, 3]} pos={[-10, 9.9, -13]} color="#c9c8c2" />
      <Box size={[3, 1.1, 2.4]} pos={[12, 9.75, -9]} color="#c9c8c2" />
      {/* parking */}
      <Lines items={stallLines} />
      {[-4.05, 1.35].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.043, 3.9]} receiveShadow>
          <planeGeometry args={[2.5, 5.3]} />
          <meshStandardMaterial map={isa} roughness={0.85} />
        </mesh>
      ))}
      <Lines items={hatch} />
      {/* curb ramp lined up with the aisle, in caution yellow */}
      <Box size={[1.9, 0.12, 1.3]} pos={[-1.35, 0.1, -0.55]} rot={[0.12, 0, 0]} color="#f2c230" shadow={false} />
      {cars.map(([x, z, c]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <Box size={[1.85, 0.7, 4.3]} pos={[0, 0.55, 0]} color={c} rough={0.45} metal={0.2} />
          <Box size={[1.6, 0.55, 2.2]} pos={[0, 1.15, -0.2]} color="#46525c" rough={0.2} metal={0.3} />
        </group>
      ))}
      {[[-26, 0.5], [26, 0.5], [-26, 21.5], [26, 21.5], [0, 11]].map(([x, z]) => (
        <group key={`p${x},${z}`} position={[x, 0, z]}>
          <mesh position={[0, 3.5, 0]} castShadow><cylinderGeometry args={[0.09, 0.12, 7, 8]} /><meshStandardMaterial color="#5d666e" /></mesh>
          <Box size={[1.2, 0.18, 0.4]} pos={[0.45, 7, 0]} color="#5d666e" />
        </group>
      ))}
      {trees.map(([x, z]) => (
        <group key={`t${x},${z}`} position={[x, 0, z]}>
          <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[0.18, 0.24, 2.4, 6]} /><meshStandardMaterial color="#7a6a58" /></mesh>
          <mesh position={[0, 3.6, 0]} castShadow><icosahedronGeometry args={[2.1, 0]} /><meshStandardMaterial color="#7f9a78" roughness={1} flatShading /></mesh>
        </group>
      ))}
    </group>
  );
}

function Rig({ shot, offset, reduced, pins }: {
  shot: Shot; offset: number; reduced: boolean; pins: React.RefObject<Record<string, HTMLElement | null>>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const pos = useRef(new THREE.Vector3(...SHOTS.entry.pos));
  const target = useRef(new THREE.Vector3(...SHOTS.entry.target));
  const shift = useRef(0);
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const tmp = useMemo(() => ({ goal: new THREE.Vector3(), aim: new THREE.Vector3(), v: new THREE.Vector3() }), []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((state, dt) => {
    const s = SHOTS[shot];
    const t = state.clock.elapsedTime;
    tmp.goal.set(...s.pos);
    tmp.aim.set(...s.target);
    const idle = !reduced && (shot === "intro" || shot === "search");
    if (idle) tmp.goal.applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin((t / 40) * Math.PI * 2) * 0.1);  // slow ±6° orbit
    // Frame-rate independent damping: interruptible by construction, any new goal is chased from where the camera is.
    const k = reduced ? 1 : 1 - Math.exp(-dt * (shot === "launch" ? 4.2 : 2.4));
    const p = pointer.current;
    const pk = reduced ? 0 : 1 - Math.exp(-dt * 3);
    p.sx += (p.x - p.sx) * pk; p.sy += (p.y - p.sy) * pk;
    pos.current.lerp(tmp.goal, k);
    target.current.lerp(tmp.aim, k);
    shift.current += (offset - shift.current) * (reduced ? 1 : 1 - Math.exp(-dt * 3));
    const par = shot === "launch" || shot === "selected" ? 0.3 : 1;
    camera.position.copy(pos.current);
    camera.position.x += p.sx * 1.6 * par;
    camera.position.y += -p.sy * 1.0 * par;
    camera.lookAt(target.current);
    // HeatHunter's trick: shift the projection so the building centres in the free space beside text or a panel.
    camera.setViewOffset(size.width, size.height, -shift.current, 0, size.width, size.height);

    // Pins: project anchors and move their DOM nodes directly (no React render per frame).
    const els = pins.current;
    for (const [id, a] of Object.entries(PIN_ANCHORS)) {
      const el = els?.[id];
      if (!el) continue;
      tmp.v.set(...a).project(camera);
      const x = (tmp.v.x * 0.5 + 0.5) * size.width, y = (-tmp.v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      // Hide pins that fall behind the camera or too close to the edges, where labels would clip.
      el.dataset.behind = tmp.v.z > 1 || x < 24 || x > size.width - 200 || y < 90 || y > size.height - 60 ? "true" : "false";
    }
  });
  return null;
}

export default function LandingScene({ shot, offset, reduced, pins, onReady }: {
  shot: Shot; offset: number; reduced: boolean;
  pins: React.RefObject<Record<string, HTMLElement | null>>; onReady: () => void;
}) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 32, near: 1, far: 400, position: SHOTS.entry.pos }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} onCreated={({ scene }) => {
        scene.background = new THREE.Color(BG);
        scene.fog = new THREE.Fog(BG, 85, 190);
        onReady();
      }} aria-hidden="true">
      <hemisphereLight args={["#e8eef5", "#8f8a80", 1.15]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[34, 46, 26]} intensity={2.3} color="#fff0dc" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45}
        shadow-camera-bottom={-45} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      <directionalLight position={[-30, 20, -10]} intensity={0.35} color="#cfdcee" />
      <Site />
      <Rig shot={shot} offset={offset} reduced={reduced} pins={pins} />
    </Canvas>
  );
}
