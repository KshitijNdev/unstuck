"use client";

import { useEffect, useState } from "react";
import { checkIntegration, getSources, type Audit, type Integration } from "@/lib/api";

const NAME: Record<Integration["provider"], string> = {
  costar: "CoStar", vexcel: "Vexcel", matterport: "Matterport", gemini: "Gemini", claude: "Claude",
};
const STATE_TEXT: Record<Integration["state"] | "running", string> = {
  verified: "Verified", configured: "Configured, not checked", failed: "Check failed", unavailable: "Unavailable", running: "Checking",
};

/** What this audit actually got from each provider. Derived from the audit record, never assumed. */
function auditFacts(audit: Audit, p: Integration["provider"]): string {
  const ev = (provider: string) => audit.evidence.find((e) => e.provider === provider);
  const failed = (needle: string) => audit.events.some((e) => e.type === "FETCH_FAILURE" && e.summary.includes(needle));
  if (p === "costar") {
    const rec = ev("CoStar");
    return rec ? `Matched record ${rec.provider_asset_id ?? audit.property.id}` : audit.is_synthetic ? "Demo property, no CoStar record" : "No CoStar record for this property";
  }
  if (p === "vexcel") {
    if (ev("Vexcel")) return "Image fetched for this audit. Not permitted for AI processing.";
    return failed("Vexcel") ? "Image request failed for this audit" : "Not used for this audit";
  }
  if (p === "matterport") {
    const linked = ((ev("CoStar")?.geometry?.summary as { model_ids?: string[] } | undefined)?.model_ids ?? []).length;
    return ev("Matterport") ? `Tour loaded, ${linked} linked scan${linked === 1 ? "" : "s"}` : linked ? `${linked} linked scan(s), tour not loaded` : "No linked scan";
  }
  if (p === "gemini") {
    const runs = audit.evidence.filter((e) => e.geometry?.ai);
    if (!runs.length) return "No analysis yet for this audit";
    return runs.map((e) => {
      const ai = e.geometry!.ai!;
      const c = ai.candidates ?? [];
      if (ai.status === "running") return `${e.provider}: analyzing ${ai.progress?.view ?? ""}`;
      if (ai.status === "failed") return `${e.provider}: ${ai.error?.message ?? "failed"}`;
      return `${e.provider}: ${c.length} suggestion${c.length === 1 ? "" : "s"}, ${c.filter((x) => x.status === "accepted").length} accepted`;
    }).join(". ");
  }
  return audit.engine === "claude_agent" ? "This audit was planned by the Claude agent" : "This audit ran on the scripted pipeline";
}

export function IntegrationsPanel({ audit }: { audit?: Audit }) {
  const [rows, setRows] = useState<Integration[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSources().then((r) => setRows(r.integrations)).catch((e: Error) => setError(e.message));
  }, []);

  async function check(p: Integration["provider"]) {
    setChecking(p);
    setError(null);
    try {
      const row = await checkIntegration(p);
      setRows((rs) => rs?.map((r) => (r.provider === p ? row : r)) ?? null);
    } catch (e) { setError((e as Error).message); }
    finally { setChecking(null); }
  }

  if (!rows) return error ? <p className="ig-error" role="alert">{error}</p> : <p className="ig-loading" role="status">Reading integration status…</p>;
  const verified = rows.filter((r) => r.state === "verified").length;

  return (
    <div className="ig">
      <p className="ig-summary">{verified} of {rows.length} verified. A key alone only counts as configured; Check makes one real request.</p>
      {error && <p className="ig-error" role="alert">{error}</p>}
      <ul>
        {rows.map((r) => {
          const state = checking === r.provider ? "running" : r.state;
          return (
            <li key={r.provider} className="ig-row">
              <span className={`ig-dot ${state}`} aria-hidden="true" />
              <div className="ig-body">
                <p className="ig-head"><strong>{NAME[r.provider]}</strong><span>{r.role}{r.model ? `, ${r.model}` : ""}</span></p>
                <p className={`ig-state ${state}`}>{STATE_TEXT[state]}{r.checked_at ? ` at ${new Date(r.checked_at).toLocaleTimeString()}` : ""}</p>
                <p className="ig-detail">{r.check_detail ?? r.detail}</p>
                {audit && <p className="ig-audit">{auditFacts(audit, r.provider)}</p>}
              </div>
              {r.state !== "unavailable" && r.provider !== "costar" && (
                <button type="button" className="ig-check" disabled={checking !== null} onClick={() => check(r.provider)}
                  title={r.provider === "vexcel" ? "Requests one real orthophoto" : r.provider === "gemini" ? "Reads model metadata; no generation" : "Makes one real request"}>
                  {checking === r.provider ? "Checking…" : "Check"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
