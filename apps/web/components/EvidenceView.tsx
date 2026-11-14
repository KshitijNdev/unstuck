import { evidenceUrl, type Evidence, type Finding } from "@/lib/api";

function Provenance({ ev }: { ev: Evidence }) {
  const scale = ev.scale as { native_resolution?: number; units?: string; note?: string } | null;
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted">Source</dt>
      <dd>
        {ev.provider} · {ev.is_synthetic ? "synthetic" : ev.is_sponsor_source ? "sponsor source" : "public fallback"}
      </dd>
      <dt className="text-muted">Captured</dt>
      <dd>{ev.capture_date ?? "Unknown"}</dd>
      {scale?.native_resolution && (
        <>
          <dt className="text-muted">Resolution</dt>
          <dd>{scale.native_resolution} {scale.units}/pixel</dd>
        </>
      )}
      {scale?.note && (<><dt className="text-muted">Resolution</dt><dd>{scale.note}</dd></>)}
      <dt className="text-muted">Rights</dt>
      <dd>{ev.rights ?? "Unknown"}</dd>
      {ev.quality && (<><dt className="text-muted">Limits</dt><dd>{ev.quality}</dd></>)}
    </dl>
  );
}

function Schematic({ ev, selected }: { ev: Evidence; selected: Finding | null }) {
  const regions = ev.geometry?.regions ?? [];
  const W = 600, H = 400;
  const hit = regions.find((r) => r.id === selected?.location_id);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className="w-full rounded-xl border border-line bg-[#f3efe6]"
      aria-label={`Synthetic site schematic. ${hit ? `Highlighted: ${hit.label}.` : "No location highlighted."}`}>
      {regions.map((r) => {
        const on = r.id === selected?.location_id;
        const fill = r.kind === "building" ? "#d9d2c3" : r.kind === "lot" ? "#c9d3d6" : "#ffffff";
        return (
          <g key={r.id}>
            <rect x={r.x * W} y={r.y * H} width={r.w * W} height={r.h * H} rx={6} fill={fill}
              stroke={on ? "#0e6b5c" : "#5a6172"} strokeWidth={on ? 5 : 1.5} strokeDasharray={on ? "10 5" : undefined} />
            <text x={r.x * W + 8} y={r.y * H + (r.kind === "door" ? -6 : 20)} fontSize={r.kind === "door" ? 12 : 14}
              fontWeight={on ? 700 : 500} fill="#1b1f2a">
              {on ? "▶ " : ""}{r.label}
            </text>
          </g>
        );
      })}
      <text x={W - 10} y={H - 10} textAnchor="end" fontSize={12} fontWeight={700} fill="#1b1f2a">
        SYNTHETIC SCHEMATIC · NOT IMAGERY
      </text>
    </svg>
  );
}

export function EvidenceView({ evidence, selected }: { evidence: Evidence[]; selected: Finding | null }) {
  const site = evidence.find((e) => e.asset_type === "schematic" || e.asset_type === "aerial_image");
  const tour = evidence.find((e) => e.asset_type === "tour");
  const summary = tour?.geometry?.summary as { name?: string; address?: string; panos?: number; wall_graph_edge_types?: Record<string, number> } | undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="site-h" className="rounded-2xl border border-line bg-card p-4">
        <h3 id="site-h" className="font-semibold">From above</h3>
        {!site && <p className="mt-2 text-sm text-muted">No aerial image for this site. Exterior checks rely on what a person records.</p>}
        {site?.asset_type === "schematic" && <div className="mt-2"><Schematic ev={site} selected={selected} /></div>}
        {site?.asset_type === "aerial_image" && site.view_url && (
          <div className="mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote provider imagery, not optimizable */}
            <img src={evidenceUrl(site.view_url)} className="aspect-square w-full rounded-xl border border-line object-cover"
              alt={`Aerial image from ${site.provider} centred on the entered coordinates, captured ${site.capture_date ?? "on an unknown date"}.`} />
            <p className="mt-2 text-sm text-muted">
              {selected
                ? `"${selected.location}" has not been located on this image yet. Marking locations on imagery is not built.`
                : "Select a check to see where it applies."}
            </p>
          </div>
        )}
        {site && <Provenance ev={site} />}
      </section>

      <section aria-labelledby="tour-h" className="rounded-2xl border border-line bg-card p-4">
        <h3 id="tour-h" className="font-semibold">Inside</h3>
        {!tour && (
          <p className="mt-2 text-sm text-muted">
            No authorized 3D model is linked to this property. Door widths need a tape measure on site; nothing is
            estimated from a tour of a different building.
          </p>
        )}
        {tour && (
          <>
            {tour.view_url ? (
              <iframe src={tour.view_url} title={`Matterport 3D tour of ${summary?.name ?? "the property"}`} allow="xr-spatial-tracking"
                className="mt-2 aspect-video w-full rounded-xl border border-line" />
            ) : (
              <p className="mt-2 text-sm text-muted">This model is private, so its tour cannot be embedded.</p>
            )}
            <p className="mt-2 text-sm">
              {summary?.name} · {summary?.address ?? "address unknown"} · {summary?.panos ?? 0} scan positions
            </p>
            {summary?.wall_graph_edge_types && (
              <p className="mt-1 text-sm text-muted">
                Wall graph edge types: {Object.entries(summary.wall_graph_edge_types).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}.
                Not used for any check.
              </p>
            )}
            <Provenance ev={tour} />
          </>
        )}
      </section>
    </div>
  );
}
