import { STATUS, type FindingStatus, type SourceStatus } from "@/lib/api";

export function StatusBadge({ status }: { status: FindingStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {s.text}
    </span>
  );
}

export function SyntheticBanner() {
  return (
    <p role="note" className="rounded-xl border-2 border-dashed border-ink bg-sun/40 px-4 py-2 text-sm font-medium">
      <span aria-hidden="true">▲ </span>
      Synthetic demo data. This property does not exist and no value here was observed at a real building.
    </p>
  );
}

const STATE = {
  connected: { icon: "●", text: "Connected", cls: "text-pass" },
  limited: { icon: "◐", text: "Limited", cls: "text-review" },
  unavailable: { icon: "○", text: "Unavailable", cls: "text-muted" },
} as const;

export function CoverageCards({ sources }: { sources: SourceStatus[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {sources.map((s) => {
        const st = STATE[s.state];
        return (
          <li key={s.provider} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{s.provider}</h3>
              <span className="text-xs uppercase tracking-wide text-muted">{s.layer}</span>
            </div>
            <p className={`mt-1 text-sm font-semibold ${st.cls}`}>
              <span aria-hidden="true">{st.icon} </span>
              {st.text}
              <span className="font-normal text-muted"> · {s.is_sponsor_source ? "sponsor source" : "public fallback"}</span>
            </p>
            <p className="mt-2 text-sm text-muted">{s.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl border border-fail bg-fail-bg px-4 py-2 text-sm text-fail">
      {message}
    </p>
  );
}
