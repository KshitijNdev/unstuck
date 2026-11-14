import { STATUS, type FindingStatus, type SourceStatus } from "@/lib/api";

export function StatusBadge({ status }: { status: FindingStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {s.text}
    </span>
  );
}

export function SyntheticBanner() {
  return (
    <p role="note" className="border-l-4 border-paint bg-review-bg px-4 py-2.5 text-[0.95rem] font-medium">
      Synthetic demo data. This property does not exist and no value here was observed at a real building.
    </p>
  );
}

const STATE = {
  connected: { dot: "bg-pass", text: "Connected" },
  limited: { dot: "bg-paint", text: "Limited" },
  unavailable: { dot: "bg-transparent border border-muted", text: "Unavailable" },
} as const;

const LAYER: Record<string, string> = { property: "Property record", aerial: "From above", interior: "Inside" };

/** Data sources as a plain table: what each one is, whether it answered, and what it can't do. */
export function CoverageCards({ sources }: { sources: SourceStatus[] }) {
  return (
    <div className="sheet overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-[0.95rem]">
        <thead className="text-sm text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Layer</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => {
            const st = STATE[s.state];
            return (
              <tr key={s.provider} className="border-b border-line-soft align-top last:border-0">
                <th scope="row" className="px-4 py-3 font-semibold">
                  {s.provider}
                  <span className="block text-sm font-normal text-muted">
                    {s.is_sponsor_source ? "Sponsor data" : "Public fallback"}
                  </span>
                </th>
                <td className="px-4 py-3">{LAYER[s.layer] ?? s.layer}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`mr-2 inline-block size-2.5 rounded-full ${st.dot}`} aria-hidden="true" />
                  {st.text}
                </td>
                <td className="px-4 py-3 text-muted">{s.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="border-l-4 border-fail bg-fail-bg px-4 py-2.5 text-[0.95rem] text-fail">
      {message}
    </p>
  );
}
