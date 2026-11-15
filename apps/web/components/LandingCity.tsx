"use client";

/**
 * The illustrative neighbourhood around the landing page's subject site: a 3x3 street grid with the subject block
 * (drawn in LandingScene) in the middle. Hand-placed, not procedural, and never real CoStar, Vexcel or Matterport geometry.
 * Nothing here is interactive. Repeated things (trees, lights, cars, paint) are instanced; buildings share a few
 * canvas facade textures.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Style = "punched" | "band" | "glass" | "brick" | "garage";
type Bldg = { x: number; z: number; w: number; d: number; h: number; style: Style; tone?: string; base?: number; units?: number };
type Item = { x: number; z: number; w: number; d: number; y?: number; h?: number; r?: number; s?: number; c?: string };

export const ROAD = 10;
const H_ROADS = [-92, -27, 30, 95];   // z of east-west streets
const V_ROADS = [-108, -38, 38, 108]; // x of north-south streets
const SPAN = 340;
const PAVE = "#3b4249", WALK = "#d8d7d0", GRASS = "#a8b596", ROOF = "#cfccc3";

/** Blocks between the streets, [x0, x1, z0, z1]; the middle one is the subject site. */
const BLOCKS: [number, number, number, number][] = [];
for (const [x0, x1] of [[-103, -43], [-33, 33], [43, 103]]) for (const [z0, z1] of [[-87, -32], [-22, 25], [35, 90]]) BLOCKS.push([x0, x1, z0, z1]);

const BUILDINGS: Bldg[] = [
  // North-west: glass office tower on a podium, set back behind a plaza
  { x: -78, z: -62, w: 34, d: 30, h: 9, style: "band", tone: "#e6e3db" },
  { x: -80, z: -64, w: 20, d: 18, h: 52, style: "glass", base: 9, units: 2 },
  // North: a varied street wall behind the subject building
  { x: -20, z: -52, w: 22, d: 26, h: 17, style: "punched", tone: "#e9e5dc", units: 2 },
  { x: 4, z: -48, w: 18, d: 20, h: 27, style: "band", tone: "#dcd8cf", units: 1 },
  { x: 23, z: -60, w: 14, d: 34, h: 13, style: "brick" },
  // North-east: stepped tower
  { x: 73, z: -60, w: 36, d: 36, h: 19, style: "punched", tone: "#e4e1d8" },
  { x: 73, z: -60, w: 24, d: 24, h: 24, style: "glass", base: 19 },
  { x: 73, z: -60, w: 14, d: 14, h: 6, style: "band", tone: "#d6d3ca", base: 43, units: 1 },
  // West: big-box store facing its own lot
  { x: -73, z: -10, w: 44, d: 20, h: 9, style: "band", tone: "#ece9e2", units: 3 },
  // East: two mid-rise offices
  { x: 57, z: -6, w: 22, d: 24, h: 21, style: "punched", tone: "#d9d4c8", units: 1 },
  { x: 89, z: 0, w: 16, d: 38, h: 14, style: "band", tone: "#e8e5dd", units: 2 },
  // South-west: low retail strip
  { x: -73, z: 48, w: 52, d: 13, h: 6, style: "band", tone: "#efece5", units: 2 },
  { x: -88, z: 75, w: 22, d: 18, h: 11, style: "brick" },
  // South: park pavilion (the rest of the block is park)
  { x: 18, z: 72, w: 9, d: 6, h: 4, style: "glass" },
  // South-east: parking garage and a corner building
  { x: 78, z: 66, w: 40, d: 32, h: 12, style: "garage" },
  { x: 54, z: 46, w: 16, d: 16, h: 16, style: "punched", tone: "#e2ded4", units: 1 },
];

/** Distant massing beyond the grid; fog turns it into a skyline. */
const SKYLINE: Bldg[] = [
  [-150, -130, 30, 26, 46], [-112, -140, 22, 22, 70], [-70, -132, 30, 24, 38], [-28, -138, 24, 24, 58], [14, -130, 34, 26, 34],
  [52, -140, 22, 22, 78], [92, -132, 30, 26, 44], [140, -138, 26, 24, 60], [-150, -60, 24, 30, 30], [150, -50, 24, 30, 36],
  [-152, 20, 22, 26, 22], [152, 30, 22, 26, 26], [-150, 90, 26, 24, 18], [150, 100, 26, 24, 20],
].map(([x, z, w, d, h]) => ({ x, z, w, d, h, style: (h > 50 ? "glass" : "band") as Style, tone: "#dfe2e3" }));

const TEX_CACHE = new Map<string, THREE.CanvasTexture>();
/** One bay (4 m) by one storey (3.6 m) of facade, tiled across each face. */
function facade(style: Style, tone: string) {
  const key = `${style}${tone}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key)!;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d")!;
  const glass = g.createLinearGradient(0, 0, 0, 64);
  glass.addColorStop(0, "#8ea2b1"); glass.addColorStop(1, "#5f7383");
  g.fillStyle = tone; g.fillRect(0, 0, 64, 64);
  g.fillStyle = glass;
  if (style === "punched") g.fillRect(14, 16, 36, 30);
  if (style === "band") g.fillRect(0, 18, 64, 28);
  if (style === "brick") { g.fillRect(9, 14, 16, 34); g.fillRect(39, 14, 16, 34); }
  if (style === "glass") { g.fillRect(0, 0, 64, 64); g.fillStyle = "#d4dbe0"; g.fillRect(0, 60, 64, 4); g.fillRect(0, 0, 2, 64); g.fillRect(32, 0, 1, 64); }
  if (style === "garage") { g.fillStyle = "#3c434a"; g.fillRect(0, 22, 64, 26); }
  if (style === "band") { g.fillStyle = tone; for (const x of [0, 16, 32, 48]) g.fillRect(x, 18, 1.5, 28); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  TEX_CACHE.set(key, t);
  return t;
}

const TONE: Record<Style, string> = { punched: "#e7e3da", band: "#e6e3dc", glass: "#7f93a2", brick: "#b9a594", garage: "#cfcdc6" };

function Building({ b, shadow = true }: { b: Bldg; shadow?: boolean }) {
  const mats = useMemo(() => {
    const base = facade(b.style, b.tone ?? TONE[b.style]);
    const face = (span: number) => {
      const t = base.clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, Math.round(span / 4)), Math.max(1, Math.round(b.h / 3.6)));
      return new THREE.MeshStandardMaterial({ map: t, roughness: b.style === "glass" ? 0.35 : 0.85, metalness: b.style === "glass" ? 0.25 : 0 });
    };
    const roof = new THREE.MeshStandardMaterial({ color: ROOF, roughness: 0.95 });
    const sx = face(b.d), sz = face(b.w);
    return [sx, sx, roof, roof, sz, sz];
  }, [b]);
  const y0 = (b.base ?? 0) + 0.15;
  const units = Array.from({ length: b.units ?? 0 }, (_, i) => i);
  return (
    <group position={[b.x, y0, b.z]}>
      <mesh position={[0, b.h / 2, 0]} material={mats} castShadow={shadow} receiveShadow>
        <boxGeometry args={[b.w, b.h, b.d]} />
      </mesh>
      {b.style !== "glass" && (
        <mesh position={[0, b.h + 0.3, 0]} castShadow={shadow} receiveShadow>
          <boxGeometry args={[b.w + 0.4, 0.6, b.d + 0.4]} />
          <meshStandardMaterial color="#dedbd3" roughness={0.9} />
        </mesh>
      )}
      {units.map((i) => (
        <mesh key={i} position={[(i - (units.length - 1) / 2) * Math.min(6, b.w / 3), b.h + 1.1, -b.d * 0.18]} castShadow={shadow}>
          <boxGeometry args={[3, 1.4, 2.4]} />
          <meshStandardMaterial color="#c4c2bb" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Many boxes (or shapes) in one draw call. */
function Instances({ items, color, geo = "box", shadow = false, rough = 0.9 }: {
  items: Item[]; color?: string; geo?: "box" | "canopy" | "trunk"; shadow?: boolean; rough?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.r ?? 0, 0));
      const s = it.s ?? 1;
      m.compose(new THREE.Vector3(it.x, it.y ?? 0, it.z), q, new THREE.Vector3(it.w * s, (it.h ?? 1) * s, it.d * s));
      ref.current!.setMatrixAt(i, m);
      if (it.c) ref.current!.setColorAt(i, col.set(it.c));
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={shadow} receiveShadow>
      {geo === "box" && <boxGeometry args={[1, 1, 1]} />}
      {geo === "canopy" && <icosahedronGeometry args={[1, 0]} />}
      {geo === "trunk" && <cylinderGeometry args={[0.75, 1, 1, 6]} />}
      <meshStandardMaterial color={items[0]?.c ? "#ffffff" : color} roughness={rough} flatShading={geo === "canopy"} />
    </instancedMesh>
  );
}

/** Deterministic 0..1 from an index, so the city is identical on every load. */
const hash = (n: number) => { const x = Math.sin(n * 12.9898 + 7.13) * 43758.5453; return x - Math.floor(x); };
const inRoad = (v: number, roads: number[]) => roads.some((r) => Math.abs(v - r) < ROAD / 2 + 3);

function useCityLayout() {
  return useMemo(() => {
    const paint: Item[] = [], warn: Item[] = [], trees: Item[] = [], lights: Item[] = [], cars: Item[] = [], cabins: Item[] = [];
    // Dashed centre lines, broken at intersections.
    for (const z of H_ROADS) for (let x = -SPAN / 2; x < SPAN / 2; x += 9) if (!inRoad(x, V_ROADS)) paint.push({ x, z, w: 3, d: 0.18, y: 0.04, h: 0.02 });
    for (const x of V_ROADS) for (let z = -SPAN / 2; z < SPAN / 2; z += 9) if (!inRoad(z, H_ROADS)) paint.push({ x, z, w: 0.18, d: 3, y: 0.04, h: 0.02 });
    // Zebra crossings on every approach of the four inner intersections, with warning strips where they meet the curb.
    // road "h" = crossing an east-west street (bars long in x, stacked across it); "v" = crossing a north-south street.
    const zebra = (cx: number, cz: number, road: "h" | "v") => {
      for (let k = -4; k <= 4; k++) paint.push(road === "h" ? { x: cx, z: cz + k, w: 2.8, d: 0.5, y: 0.04, h: 0.02 } : { x: cx + k, z: cz, w: 0.5, d: 2.8, y: 0.04, h: 0.02 });
      for (const sgn of [-1, 1]) warn.push(road === "h" ? { x: cx, z: cz + sgn * 5.6, w: 2.8, d: 0.6, y: 0.16, h: 0.03 } : { x: cx + sgn * 5.6, z: cz, w: 0.6, d: 2.8, y: 0.16, h: 0.03 });
    };
    for (const cx of [-38, 38]) for (const cz of [-27, 30]) {
      zebra(cx - 7, cz, "h"); zebra(cx + 7, cz, "h"); zebra(cx, cz - 7, "v"); zebra(cx, cz + 7, "v");
    }
    zebra(0, 30, "h");  // mid-block crossing from the park to the subject site's walk
    // Street trees and lights along every block edge, keeping the crossing clear.
    for (const [x0, x1, z0, z1] of BLOCKS) {
      const centre = x0 === -33 && z0 === -22;
      const edge = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 11);
        for (let i = 1; i < n; i++) {
          const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          if (Math.abs(x) < 4 && (z > 20 && z < 40)) continue;
          if (i % 2) trees.push({ x, z, w: 1, d: 1, s: 0.85 + hash(trees.length) * 0.35 });
          else lights.push({ x, z, w: 1, d: 1 });
        }
      };
      const i = 1.6;
      if (!centre) { edge(x0 + i, z1 - i, x1 - i, z1 - i); edge(x0 + i, z0 + i, x1 - i, z0 + i); }
      edge(x0 + i, z0 + i, x0 + i, z1 - i); edge(x1 - i, z0 + i, x1 - i, z1 - i);
    }
    // The park: loose clusters, not a grid.
    for (let k = 0; k < 30; k++) {
      const x = -26 + hash(k * 2 + 300) * 52, z = 40 + hash(k * 2 + 301) * 45;
      if (Math.abs(x) < 3 || Math.abs(z - 62.5) < 3 || Math.hypot(x - 18, z - 72) < 8) continue;  // paths and pavilion
      trees.push({ x, z, w: 1, d: 1, s: 0.9 + hash(k + 500) * 0.6 });
    }
    // Traffic: a few cars in lanes, parked cars in the neighbour lot.
    const palette = ["#8d969d", "#c9ccc8", "#5c6a78", "#b8b1a5", "#a4abb0", "#6f7a72", "#d6d4cd", "#7b5e57"];
    const car = (x: number, z: number, r: number) => {
      cars.push({ x, z, w: 1.85, d: 4.3, h: 0.7, y: 0.55, r, c: palette[Math.floor(hash(cars.length + 900) * palette.length)] });
      cabins.push({ x, z, w: 1.6, d: 2.2, h: 0.55, y: 1.15, r });
    };
    let lane = 0;
    for (const z of [30, -27]) for (const x of [-125, -76, -55, 18, 61, 84, 131]) car(x, z + (lane++ % 2 ? 2.5 : -2.5), Math.PI / 2);
    for (const x of [-38, 38]) for (const z of [-72, -46, 54, 74]) car(x + (lane++ % 2 ? 2.5 : -2.5), z, 0);
    for (const k of [0, 1, 3, 5, 6, 8]) car(-96.4 + k * 3.25, 13, 0);  // west lot, leaving the accessible stalls free
    return { paint, warn, trees, lights, cars, cabins };
  }, []);
}

const ISA_TEX: { t?: THREE.CanvasTexture } = {};
function isa() {
  if (ISA_TEX.t) return ISA_TEX.t;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1450a3"; g.fillRect(0, 0, 64, 128);
  g.strokeStyle = g.fillStyle = "#f4f4f0"; g.lineWidth = 4; g.lineCap = "round";
  g.beginPath(); g.arc(30, 40, 5, 0, 7); g.fill();
  g.beginPath(); g.moveTo(29, 48); g.lineTo(29, 66); g.lineTo(42, 66); g.lineTo(47, 78); g.stroke();
  g.beginPath(); g.arc(29, 70, 12, 0.5, 3.9); g.stroke();
  ISA_TEX.t = new THREE.CanvasTexture(c);
  ISA_TEX.t.colorSpace = THREE.SRGBColorSpace;
  return ISA_TEX.t;
}

export default function City() {
  const L = useCityLayout();
  const tex = useMemo(() => isa(), []);
  // Neighbour lot in the west block: ordinary stalls, then two accessible stalls sharing a hatched aisle (x -62.4 to -56.0).
  const lotLines = useMemo(() => {
    const out: Item[] = [];
    for (let k = 0; k <= 9; k++) out.push({ x: -98 + k * 3.25, z: 13, w: 0.12, d: 5.2, y: 0.2, h: 0.02 });
    for (const x of [-62.4, -59.4, -57.6, -54.6]) out.push({ x, z: 13, w: 0.12, d: 5.2, y: 0.2, h: 0.02 });
    for (let k = 0; k < 6; k++) out.push({ x: -58.5, z: 10.9 + k * 0.85, w: 2.1, d: 0.14, y: 0.2, h: 0.02, r: -0.6 });
    return out;
  }, []);
  const trunks = useMemo(() => L.trees.map((t) => ({ ...t, w: 0.22, d: 0.22, h: 2.4, y: 1.2 * (t.s ?? 1) + 0.15 })), [L.trees]);
  const crowns = useMemo(() => L.trees.map((t, i) => ({ ...t, w: 2, d: 2, h: 2, y: 3.6 * (t.s ?? 1) + 0.15, c: i % 3 ? "#7f9a78" : "#8aa281" })), [L.trees]);
  const poles = useMemo(() => L.lights.map((t) => ({ ...t, w: 0.1, d: 0.1, h: 6.5, y: 3.4 })), [L.lights]);
  const heads = useMemo(() => L.lights.map((t) => ({ ...t, w: 0.9, d: 0.35, h: 0.16, y: 6.6 })), [L.lights]);

  return (
    <group>
      {/* Streets */}
      {H_ROADS.map((z) => <mesh key={`h${z}`} position={[0, 0.015, z]} receiveShadow><boxGeometry args={[SPAN, 0.03, ROAD]} /><meshStandardMaterial color={PAVE} roughness={0.95} /></mesh>)}
      {V_ROADS.map((x) => <mesh key={`v${x}`} position={[x, 0.016, 0]} receiveShadow><boxGeometry args={[ROAD, 0.03, SPAN]} /><meshStandardMaterial color={PAVE} roughness={0.95} /></mesh>)}
      {/* Blocks: a raised walk around each, then what fills it. The subject block keeps its own ground from LandingScene. */}
      {BLOCKS.map(([x0, x1, z0, z1]) => {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
        if (x0 === -33 && z0 === -22) return (
          <group key="centre">
            {[-31.5, 31.5].map((x) => <mesh key={x} position={[x, 0.075, 1.5]} receiveShadow><boxGeometry args={[3, 0.15, 47]} /><meshStandardMaterial color={WALK} roughness={1} /></mesh>)}
            <mesh position={[0, 0.075, -20.5]} receiveShadow><boxGeometry args={[60, 0.15, 3]} /><meshStandardMaterial color={WALK} roughness={1} /></mesh>
          </group>
        );
        const park = x0 === -33 && z0 === 35;
        return (
          <group key={`${x0},${z0}`}>
            <mesh position={[cx, 0.075, cz]} receiveShadow><boxGeometry args={[w, 0.15, d]} /><meshStandardMaterial color={WALK} roughness={1} /></mesh>
            <mesh position={[cx, 0.16, cz]} receiveShadow>
              <boxGeometry args={[w - 6, 0.02, d - 6]} />
              <meshStandardMaterial color={park ? GRASS : "#e2e1da"} roughness={1} />
            </mesh>
          </group>
        );
      })}
      {/* Park paths, lined up with the mid-block crossing */}
      <mesh position={[0, 0.18, 62.5]} receiveShadow><boxGeometry args={[60, 0.02, 2.4]} /><meshStandardMaterial color="#e6e2d6" roughness={1} /></mesh>
      <mesh position={[0, 0.18, 62.5]} receiveShadow><boxGeometry args={[2.4, 0.02, 49]} /><meshStandardMaterial color="#e6e2d6" roughness={1} /></mesh>
      {/* West neighbour lot */}
      <mesh position={[-76, 0.18, 13]} receiveShadow><boxGeometry args={[48, 0.02, 14]} /><meshStandardMaterial color="#454c53" roughness={0.95} /></mesh>
      {[-60.9, -56.1].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.205, 13]} receiveShadow>
          <planeGeometry args={[2.8, 5]} /><meshStandardMaterial map={tex} roughness={0.85} />
        </mesh>
      ))}
      <Instances items={lotLines} color="#f1f1ec" rough={0.8} />
      <Instances items={L.paint} color="#ecebe4" rough={0.8} />
      <Instances items={L.warn} color="#d4ae3b" rough={0.7} />
      {BUILDINGS.map((b, i) => <Building key={i} b={b} />)}
      {SKYLINE.map((b, i) => <Building key={`s${i}`} b={b} shadow={false} />)}
      <Instances items={trunks} color="#7a6a58" geo="trunk" />
      <Instances items={crowns} geo="canopy" shadow rough={1} />
      <Instances items={poles} color="#5d666e" geo="trunk" />
      <Instances items={heads} color="#5d666e" />
      <Instances items={L.cars} shadow rough={0.45} />
      <Instances items={L.cabins} color="#46525c" rough={0.25} />
    </group>
  );
}
