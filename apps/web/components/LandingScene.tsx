"use client";
/* eslint-disable react-hooks/immutability -- three.js objects and pin nodes are mutated every frame inside useFrame, which is how @react-three/fiber is meant to be used */

/**
 * Illustrative commercial site inside an illustrative city (LandingCity) for the landing page; never a real property's geometry.
 * Technique follows HeatHunter's scene: named camera shots flown with damping, a view offset so the
 * subject centres in the space a panel leaves free, a warm key light with a soft sky fill, and fog.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import City from "@/components/LandingCity";

export type Shot = "entry" | "intro" | "search" | "parking" | "entrance" | "route" | "selected" | "launch"
  | "s-record" | "s-ai" | "s-confirmed" | "s-ghost" | "s-ramp" | "s-door" | "s-act" | "s-agents";
type V3 = [number, number, number];

const SHOTS: Record<Shot, { pos: V3; target: V3 }> = {
  entry: { pos: [200, 160, 250], target: [0, 0, 0] },
  intro: { pos: [128, 112, 160], target: [-6, 0, 2] },     // chapter 1: the whole neighbourhood
  search: { pos: [62, 44, 82], target: [-1, 0, 5] },
  parking: { pos: [8, 11, 21], target: [-1.5, 0, 4] },
  entrance: { pos: [-11, 6, 11], target: [0, 2.4, -3] },
  route: { pos: [12, 6.5, 8], target: [-1.2, 0.4, -0.6] },
  selected: { pos: [6, 54, 34], target: [0, 0, 2] },
  launch: { pos: [0.01, 96, 0.6], target: [0, 0, 0.5] },
  // Scroll story shots
  "s-record": { pos: [54, 30, 50], target: [-4, 4, -8] },  // chapter 2: glide to the subject building
  "s-ai": { pos: [6, 30, 34], target: [0, 0, 4.5] },
  "s-confirmed": { pos: [-4, 46, 30], target: [-0.5, 0, 4] },  // steep enough that the lot lamppost projects south of the stalls
  "s-ghost": { pos: [9, 14, 19], target: [6, 0, 3.6] },
  "s-ramp": { pos: [-7.5, 4.6, 6.4], target: [-0.4, 0.1, -1.0] },
  "s-door": { pos: [-7, 4.6, 7], target: [0, 2.2, -3] },
  "s-act": { pos: [0.01, 118, 38], target: [0, 0, 4] },      // chapter 8: settle into the plan view the inspection opens in
  "s-agents": { pos: [-92, 64, 98], target: [0, 4, -4] },    // chapter 7: the evidence layers over the block
};

/** World-space anchors for the scene pins; the page renders the pins, the scene positions them. */
export const PIN_ANCHORS: Record<"parking" | "entrance" | "route" | "ghost" | "door" | "ramp" | "building" | "lot", V3> = {
  building: [-12, 9.9, -11],
  lot: [-1.35, 0.3, 0.7],
  ramp: [-1.35, 0.9, -2.3],
  ghost: [6.75, 0.3, 2.2],
  door: [0, 3.05, -2.45],
  parking: [-4.05, 0.3, 4.6],
  entrance: [0, 3.4, -2.6],
  route: [-1.35, 0.2, -1.1],
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

/** Illustrative layout: four accessible stalls; the fifth slot (x 6.75) is where the scroll story shows the missing one. */
const ACCESSIBLE = [-6.75, -4.05, 1.35, 4.05];
const GHOST_X = 6.75;
const FALSE_POSITIVE_X = 12.15;  // an ordinary empty stall the "AI" wrongly suggests in the story

/** Ground outline that fades in and out, built from flat 14 cm strips (WebGL lines are only 1 px wide).
 *  Dashed means "AI suggestion, not yet verified"; solid means confirmed by a person. */
function Outline({ x, z, w = 2.5, d = 5.2, color, dashed = false, on, pulse = false, t = 0.14 }: {
  x: number; z: number; w?: number; d?: number; color: string; dashed?: boolean; on: boolean; pulse?: boolean; t?: number;
}) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }), [color]);
  const group = useRef<THREE.Group>(null);
  const strips = useMemo(() => {
    const out: { p: V3; s: V3 }[] = [];
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), horiz = Math.abs(z1 - z0) < 1e-6;
      const n = dashed ? Math.max(2, Math.round(len / 0.75)) : 1;
      for (let i = 0; i < n; i++) {
        const a = i / n, b = dashed ? (i + 0.55) / n : 1;
        const cx = x0 + (x1 - x0) * (a + b) / 2, cz = z0 + (z1 - z0) * (a + b) / 2, l = len * (b - a);
        out.push({ p: [cx, 0, cz], s: horiz ? [l, 0.02, t] : [t, 0.02, l] });
      }
    };
    edge(-w / 2, -d / 2, w / 2, -d / 2); edge(w / 2, -d / 2, w / 2, d / 2); edge(w / 2, d / 2, -w / 2, d / 2); edge(-w / 2, d / 2, -w / 2, -d / 2);
    return out;
  }, [w, d, dashed, t]);
  useFrame((st, dt) => {
    const goal = on ? (pulse ? 0.6 + 0.4 * Math.sin(st.clock.elapsedTime * 3) : 1) : 0;
    mat.opacity += (goal - mat.opacity) * (1 - Math.exp(-dt * 6));
    if (group.current) group.current.visible = mat.opacity > 0.01;
  });
  return (
    <group ref={group} position={[x, 0.075, z]}>
      {strips.map((st, i) => <mesh key={i} position={st.p} material={mat}><boxGeometry args={st.s} /></mesh>)}
    </group>
  );
}

/* Curb ramp, illustrative: a 1:12 wedge (0.18 m rise over 2.16 m run, 1.5 m wide) set into a cut in the 18 cm sidewalk,
   lined up with the access aisle. The old version was a thin tilted box buried inside the sidewalk slab. */
const RAMP = { x0: -2.1, x1: -0.6, run: 2.16, rise: 0.18 };
const SIDEWALK_TOP = 0.18;

function CurbRamp() {
  const geo = useMemo(() => {
    const profile = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(RAMP.run, 0), new THREE.Vector2(RAMP.run, RAMP.rise)]);
    return new THREE.ExtrudeGeometry(profile, { depth: RAMP.x1 - RAMP.x0, bevelEnabled: false });
  }, []);
  const slope = Math.atan2(RAMP.rise, RAMP.run);
  return (
    <group>
      {/* profile x -> world -z, profile y -> world y, extrusion -> world +x */}
      <mesh geometry={geo} position={[RAMP.x0, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e6e4dc" roughness={0.85} />
      </mesh>
      {/* detectable warning surface at the foot of the ramp */}
      <mesh position={[(RAMP.x0 + RAMP.x1) / 2, (0.3 / RAMP.run) * RAMP.rise + 0.012, -0.3]} rotation={[slope, 0, 0]} receiveShadow>
        <boxGeometry args={[RAMP.x1 - RAMP.x0 - 0.1, 0.012, 0.6]} />
        <meshStandardMaterial color="#e9b81f" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Height of the walking surface at (x, z): lot, ramp or sidewalk. Keeps the route on the ground. */
function surfaceY(x: number, z: number) {
  if (z >= 0) return 0.04;
  if (x > RAMP.x0 && x < RAMP.x1 && z > -RAMP.run) return (-z / RAMP.run) * RAMP.rise + 0.01;
  return SIDEWALK_TOP + 0.01;
}

/** Accessible route: aisle -> curb ramp -> entrance door, drawn as dashes that follow the surface. */
function AccessRoute({ on }: { on: boolean }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#1f6fd1", transparent: true, opacity: 0, depthWrite: false }), []);
  const group = useRef<THREE.Group>(null);
  const dashes = useMemo(() => {
    const pts: [number, number][] = [[-1.35, 5.8], [-1.35, 0.2], [-1.35, -2.4], [-0.2, -2.45]];
    const out: { p: V3; yaw: number; pitch: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.floor(len / 0.55));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const y0 = surfaceY(x, z - 0.15), y1 = surfaceY(x, z + 0.15);
        out.push({ p: [x, surfaceY(x, z) + 0.015, z], yaw: Math.atan2(bx - ax, bz - az), pitch: Math.atan2(y0 - y1, 0.3) });
      }
    }
    return out;
  }, []);
  useFrame((st, dt) => {
    const goal = on ? 0.75 + 0.25 * Math.sin(st.clock.elapsedTime * 4) : 0;
    mat.opacity += (goal - mat.opacity) * (1 - Math.exp(-dt * 6));
    if (group.current) group.current.visible = mat.opacity > 0.01;
  });
  return (
    <group ref={group}>
      {dashes.map((d, i) => (
        <mesh key={i} position={d.p} rotation={[d.pitch, d.yaw, 0, "YXZ"]} material={mat}><boxGeometry args={[0.22, 0.02, 0.3]} /></mesh>
      ))}
    </group>
  );
}

/** Translucent fill for the missing fifth stall, pulsing while the story points at it. */
function Ghost({ on }: { on: boolean }) {
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st, dt) => {
    if (!ref.current) return;
    const goal = on ? 0.22 + 0.12 * Math.sin(st.clock.elapsedTime * 3) : 0;
    ref.current.opacity += (goal - ref.current.opacity) * (1 - Math.exp(-dt * 6));
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[GHOST_X, 0.06, 3.9]}>
      <planeGeometry args={[2.5, 5.2]} />
      <meshBasicMaterial ref={ref} color="#ffffff" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Dimension line across the entrance door: clear opening width. */
function DoorDimension({ on }: { on: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current; if (!g) return;
    g.children.forEach((c) => { const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial; m.opacity += ((on ? 1 : 0) - m.opacity) * (1 - Math.exp(-dt * 6)); });
    g.visible = ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity > 0.01;
  });
  return (
    <group ref={ref} position={[0, 2.85, -2.42]}>
      <mesh><boxGeometry args={[2.1, 0.05, 0.05]} /><meshBasicMaterial color="#f2c230" transparent opacity={0} /></mesh>
      <mesh position={[-1.05, 0, 0]}><boxGeometry args={[0.05, 0.4, 0.05]} /><meshBasicMaterial color="#f2c230" transparent opacity={0} /></mesh>
      <mesh position={[1.05, 0, 0]}><boxGeometry args={[0.05, 0.4, 0.05]} /><meshBasicMaterial color="#f2c230" transparent opacity={0} /></mesh>
    </group>
  );
}

/** Fades a material's opacity toward on/off; used by the story overlays so nothing pops. */
function useFade(on: boolean, max = 1) {
  const mat = useRef<THREE.Material & { opacity: number }>(null);
  useFrame((_, dt) => {
    if (!mat.current) return;
    mat.current.opacity += ((on ? max : 0) - mat.current.opacity) * (1 - Math.exp(-dt * 5));
    mat.current.visible = mat.current.opacity > 0.01;
  });
  return mat;
}

/** The subject building's outline: the record (chapter 2) and the Matterport scan (chapter 7) describe this building. */
function Highlight({ on }: { on: boolean }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(44.3, 9.4, 14.3)), []);
  const mat = useFade(on);
  return (
    <lineSegments geometry={geo} position={[0, 4.7, -11]}>
      <lineBasicMaterial ref={mat} color="#1f56b8" transparent opacity={0} depthTest={false} />
    </lineSegments>
  );
}

/** Chapter 7: an aerial capture footprint over the block, its corners dropped to the ground. */
function AerialFrame({ on }: { on: boolean }) {
  const geo = useMemo(() => {
    const y = 26, x = 30, z0 = -21, z1 = 24, g = new THREE.BufferGeometry();
    const pts = [[-x, y, z0], [x, y, z0], [x, y, z0], [x, y, z1], [x, y, z1], [-x, y, z1], [-x, y, z1], [-x, y, z0],
      [-x, y, z0], [-x, 0.2, z0], [x, y, z0], [x, 0.2, z0], [x, y, z1], [x, 0.2, z1], [-x, y, z1], [-x, 0.2, z1]].flat();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const line = useFade(on, 0.7), fill = useFade(on, 0.08);
  return (
    <group>
      <lineSegments geometry={geo}><lineBasicMaterial ref={line} color="#1f56b8" transparent opacity={0} /></lineSegments>
      <mesh position={[0, 26, 1.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 45]} /><meshBasicMaterial ref={fill} color="#1f56b8" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Story({ shot }: { shot: Shot }) {
  const ai = shot === "s-ai" || shot === "s-agents", confirmed = shot === "s-confirmed" || shot === "s-ghost";
  return (
    <group>
      {ACCESSIBLE.map((x) => <Outline key={`ai${x}`} x={x} z={3.9} color="#f2c230" dashed on={ai} />)}
      <Outline x={FALSE_POSITIVE_X} z={3.9} color="#f2c230" dashed on={ai} />
      {ACCESSIBLE.map((x) => <Outline key={`ok${x}`} x={x} z={3.9} w={2.3} d={4.9} t={0.24} color="#3ddc84" on={confirmed} />)}
      <Outline x={GHOST_X} z={3.9} color="#ffffff" dashed on={shot === "s-ghost"} pulse />
      <Ghost on={shot === "s-ghost"} />
      <DoorDimension on={shot === "s-door"} />
      <AccessRoute on={shot === "s-ramp" || shot === "route"} />
      <Highlight on={shot === "s-record" || shot === "s-agents"} />
      <AerialFrame on={shot === "s-agents"} />
    </group>
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
  const trees: [number, number][] = [[-30, -7], [-30, 5], [-30, 17], [30, -7], [30, 5], [30, 17], [-13, 11], [13, 11], [-18, 23.7], [18, 23.7]];
  const cars: [number, number, string][] = [[-17.55, 3.9, "#8d969d"], [-12.15, 3.9, "#c9ccc8"], [9.45, 3.9, "#5c6a78"], [17.55, 3.9, "#b8b1a5"],
    [-9.45, 18.1, "#a4abb0"], [4.05, 18.1, "#6f7a72"], [14.85, 18.1, "#d6d4cd"]];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[900, 900]} /><meshStandardMaterial color="#e1e1db" roughness={1} /></mesh>
      <Box size={[54, 0.04, 22.4]} pos={[0, 0.02, 11]} color="#3d444b" shadow={false} rough={0.95} />
      <Box size={[24.9, 0.18, 4]} pos={[-14.55, 0.09, -2]} color="#d6d5ce" />
      <Box size={[27.6, 0.18, 4]} pos={[13.2, 0.09, -2]} color="#d6d5ce" />
      <Box size={[1.5, 0.18, 1.84]} pos={[-1.35, 0.09, -3.08]} color="#d6d5ce" />
      <Box size={[24.9, 0.19, 0.14]} pos={[-14.55, 0.095, -0.07]} color="#c4c2ba" shadow={false} />
      <Box size={[27.6, 0.19, 0.14]} pos={[13.2, 0.095, -0.07]} color="#c4c2ba" shadow={false} />
      {/* South walk: full block width and right up to the street, at the city's curb height */}
      <Box size={[66, 0.15, 2.7]} pos={[0, 0.075, 23.65]} color="#d6d5ce" />
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
      {ACCESSIBLE.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.043, 3.9]} receiveShadow>
          <planeGeometry args={[2.5, 5.3]} />
          <meshStandardMaterial map={isa} roughness={0.85} />
        </mesh>
      ))}
      <Lines items={hatch} />
      <CurbRamp />
      {cars.map(([x, z, c]) => (
        <group key={`${x},${z}`} position={[x, 0.04, z]}>{/* sits on the lot surface (top 0.04) on its wheels */}
          <Box size={[1.7, 0.32, 3.5]} pos={[0, 0.16, 0]} color="#22282e" rough={0.8} />
          <Box size={[1.85, 0.7, 4.3]} pos={[0, 0.59, 0]} color={c} rough={0.45} metal={0.2} />
          <Box size={[1.6, 0.55, 2.2]} pos={[0, 1.215, -0.2]} color="#46525c" rough={0.2} metal={0.3} />
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

const CLOSE = new Set<Shot>(["parking", "entrance", "route", "s-confirmed", "s-ghost", "s-ramp", "s-door"]);

function Rig({ shot, offset, reduced, pins }: {
  shot: Shot; offset: number; reduced: boolean; pins: React.RefObject<Record<string, HTMLElement | null>>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const pos = useRef(new THREE.Vector3(...SHOTS.entry.pos));
  const target = useRef(new THREE.Vector3(...SHOTS.entry.target));
  const shift = useRef(0);
  const flight = useRef({ shot: "entry" as Shot, from: new THREE.Vector3(...SHOTS.entry.pos), fromAim: new THREE.Vector3(...SHOTS.entry.target),
    ctrl: new THREE.Vector3(), t: 1, dur: 1, interrupted: false });
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const tmp = useMemo(() => ({ goal: new THREE.Vector3(), aim: new THREE.Vector3(), v: new THREE.Vector3() }), []);
  const sun = useThree((s) => s.scene.getObjectByName("sun")) as THREE.DirectionalLight | undefined;

  // Close shots get a tight shadow frustum (crisp ramp and curb shadows); city shots cover every block.
  useEffect(() => {
    if (!sun) return;
    const r = CLOSE.has(shot) ? 34 : 120, c = sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.updateProjectionMatrix();
  }, [shot, sun]);

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
    const idle = !reduced && (shot === "intro" || shot === "search" || shot === "s-agents");
    if (idle) tmp.goal.applyAxisAngle(THREE.Object3D.DEFAULT_UP, Math.sin((t / 40) * Math.PI * 2) * 0.1);  // slow ±6° orbit
    // A new shot starts a flight from wherever the camera is now (so it is interruptible): an eased arc whose control point
    // is lifted above both ends, so long moves rise over the blocks instead of cutting through them.
    const f = flight.current;
    if (f.shot !== shot) {
      const dist = pos.current.distanceTo(tmp.goal);
      f.from.copy(pos.current); f.fromAim.copy(target.current);
      f.ctrl.copy(pos.current).add(tmp.goal).multiplyScalar(0.5);
      f.ctrl.x *= 1.1; f.ctrl.z *= 1.1;  // bow outward, away from the subject building
      f.ctrl.y = Math.max(pos.current.y, tmp.goal.y, dist > 60 ? 50 : 0) + Math.min(40, dist * 0.22);
      f.interrupted = f.t < 1;
      f.t = reduced ? 1 : 0;
      f.dur = shot === "launch" ? 1.1 : Math.min(2.8, Math.max(1.0, 0.9 + dist / 80));
      f.shot = shot;
    }
    f.t = Math.min(1, f.t + dt / f.dur);
    // In-out easing normally; ease-out when a flight was cut short, so a fast reversal keeps moving instead of stopping dead.
    const e = f.interrupted ? 1 - Math.pow(1 - f.t, 3) : f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
    const p = pointer.current;
    const pk = reduced ? 0 : 1 - Math.exp(-dt * 2.2);  // softer follow: the camera trails the cursor, never snaps
    p.sx += (p.x - p.sx) * pk; p.sy += (p.y - p.sy) * pk;
    const u = 1 - e;
    pos.current.copy(f.from).multiplyScalar(u * u).addScaledVector(f.ctrl, 2 * u * e).addScaledVector(tmp.goal, e * e);
    target.current.copy(f.fromAim).lerp(tmp.aim, e);
    shift.current += (offset - shift.current) * (reduced ? 1 : 1 - Math.exp(-dt * 3));
    const par = shot === "launch" || shot === "selected" ? 0.3 : 1;
    camera.position.copy(pos.current);
    // Parallax: the eye moves a little, the aim point barely, so depth reads without the scene swinging.
    camera.position.x += p.sx * 2.4 * par;
    camera.position.y += -p.sy * 1.4 * par;
    tmp.v.copy(target.current); tmp.v.x += p.sx * 0.35 * par; tmp.v.y += -p.sy * 0.2 * par;
    camera.lookAt(tmp.v);
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
      const right = id === "ghost" || id === "door" ? 140 : 200;  // story tags are centred on the anchor; pins extend right
      el.dataset.behind = tmp.v.z > 1 || x < 24 || x > size.width - right || y < 90 || y > size.height - 60 ? "true" : "false";
    }
  });
  return null;
}

export default function LandingScene({ shot, offset, reduced, pins, onReady }: {
  shot: Shot; offset: number; reduced: boolean;
  pins: React.RefObject<Record<string, HTMLElement | null>>; onReady: () => void;
}) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 32, near: 1, far: 700, position: SHOTS.entry.pos }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} onCreated={({ scene }) => {
        scene.background = new THREE.Color(BG);
        scene.fog = new THREE.Fog(BG, 150, 400);
        onReady();
      }} aria-hidden="true">
      <hemisphereLight args={["#e8eef5", "#8f8a80", 1.15]} />
      <ambientLight intensity={0.18} />
      <directionalLight name="sun" position={[68, 92, 52]} intensity={2.3} color="#fff0dc" castShadow
        shadow-mapSize={[4096, 4096]} shadow-camera-left={-120} shadow-camera-right={120} shadow-camera-top={120}
        shadow-camera-bottom={-120} shadow-camera-far={300} shadow-bias={-0.0003} shadow-normalBias={0.03} />
      <directionalLight position={[-30, 20, -10]} intensity={0.35} color="#cfdcee" />
      <City />
      <Site />
      <Story shot={shot} />
      <Rig shot={shot} offset={offset} reduced={reduced} pins={pins} />
    </Canvas>
  );
}
