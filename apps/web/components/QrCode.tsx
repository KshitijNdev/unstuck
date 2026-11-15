"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/** A QR code drawn as one SVG path (crisp at any print size). Dark modules on white, with a quiet zone. */
export function QrCode({ value, size = 136, label }: { value: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let path = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x} ${y}h1v1h-1z`; }));
    return { n: qr.size, d: path };
  }, [value]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
