"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorNote } from "@/components/ui";
import { applyCandidates, CATEGORY_LABEL, reviewCandidate, type AiRun, type Candidate, type CandidateCategory,
  type Evidence } from "@/lib/api";

const STATUS_TEXT = { suggested: "AI suggestion, not yet verified", accepted: "Confirmed", rejected: "Rejected" } as const;
type Act = { action: "accept" | "reject" | "relabel" | "reset"; category?: CandidateCategory; van?: boolean };

function Row({ c, on, onFocus, act, busy }: { c: Candidate; on: boolean; onFocus: () => void; busy: boolean; act: (body: Act) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (on) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [on]);
  return (
    <li ref={ref} className={`sg-row ${c.status} ${on ? "on" : ""}`}>
      <button type="button" className="sg-main" onClick={onFocus} aria-pressed={on}>
        <span className={`sg-swatch ${c.status}`} aria-hidden="true" />
        <span className="sg-text">
          <strong>{CATEGORY_LABEL[c.category]}{c.van ? ", van" : ""}</strong>
          <span>{c.note || "No note from the model."}</span>
          <small>
            {STATUS_TEXT[c.status]}{c.reviewed_by ? ` by ${c.reviewed_by}` : ""}, {c.confidence} confidence, {c.view}
            {c.original_category ? `. Corrected from ${CATEGORY_LABEL[c.original_category].toLowerCase()}` : ""}
          </small>
        </span>
      </button>
      {on && (
        <div className="sg-actions">
          {c.status !== "accepted" && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act({ action: "accept" })}>Accept</button>}
          {c.status !== "rejected" && <button className="btn btn-sm" disabled={busy} onClick={() => act({ action: "reject" })}>Reject</button>}
          {c.status !== "suggested" && <button className="btn btn-sm" disabled={busy} onClick={() => act({ action: "reset" })}>Undo</button>}
          <label className="sg-correct">Correct to
            <select disabled={busy} value="" onChange={(e) => e.target.value && act({ action: "relabel", category: e.target.value as CandidateCategory })}>
              <option value="">Choose…</option>
              {(Object.keys(CATEGORY_LABEL) as CandidateCategory[]).filter((k) => k !== c.category).map((k) => (
                <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>
              ))}
            </select>
          </label>
          {c.status === "accepted" && c.category === "parking_stall" && (
            <label className="sg-van">
              <input type="checkbox" checked={!!c.van} disabled={busy} onChange={(e) => act({ action: "accept", van: e.target.checked })} />
              Van-accessible
            </label>
          )}
        </div>
      )}
    </li>
  );
}

export function SuggestionsPanel({ auditId, site, run, reviewer, setReviewer, focusId, onFocus, onChanged, analyze, error }: {
  auditId: string; site: Evidence | undefined; run: AiRun | undefined; reviewer: string; setReviewer: (v: string) => void;
  focusId: string | null; onFocus: (id: string) => void; onChanged: () => Promise<void>; analyze: React.ReactNode; error: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const candidates = run?.candidates ?? [];
  const groups = (["suggested", "accepted"] as const).map((s) => [s, candidates.filter((c) => c.status === s)] as const);
  const rejected = candidates.filter((c) => c.status === "rejected");
  const stalls = candidates.filter((c) => c.status === "accepted" && c.category === "parking_stall");
  const counted = (site?.geometry?.pins ?? []).filter((p) => p.candidate_id).length;

  async function act(c: Candidate, body: Act) {
    if (!reviewer.trim()) { setErr("Add your name above so each decision is attributed."); return; }
    setBusy(true); setErr(null); setNote(null);
    try { await reviewCandidate(auditId, c.id, { ...body, reviewer: reviewer.trim() }); await onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!site || !reviewer.trim()) { setErr("Add your name above so the count is attributed."); return; }
    setBusy(true); setErr(null);
    try {
      await applyCandidates(auditId, site.id, reviewer.trim());
      await onChanged();
      setNote(`Counted ${stalls.length} accepted stall${stalls.length === 1 ? "" : "s"}. The parking checks were updated.`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const row = (c: Candidate) => <Row key={c.id} c={c} on={focusId === c.id} busy={busy} onFocus={() => onFocus(c.id)} act={(b) => act(c, b)} />;

  return (
    <div className="sg">
      <div className="sg-head">
        <label className="sg-who">Reviewing as
          <input className="field" maxLength={80} placeholder="Your name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        </label>
        <p>Gemini suggests what it can see. Nothing counts toward a check until you accept it.</p>
      </div>

      {error && <div className="sg-pad"><ErrorNote message={error} /></div>}
      {err && <div className="sg-pad"><ErrorNote message={err} /></div>}

      {!run && (
        <div className="sg-empty">
          <h3>No analysis of this image yet</h3>
          <p>Gemini looks for accessible-parking symbols, stalls, access aisles and curb ramps, then waits for your review.</p>
          {analyze}
        </div>
      )}
      {run?.status === "running" && (
        <div className="sg-empty" role="status">
          <h3>{run.progress?.done ? `Analyzing ${run.progress.view}` : "Fetching the image"}</h3>
          <div className="sg-bar"><span style={{ width: `${((run.progress?.done ?? 0) / (run.progress?.total || 1)) * 100}%` }} /></div>
          <p>{run.progress?.done ?? 0} of {run.progress?.total ?? "?"} views done. The full frame first, then four closer crops for small markings.</p>
        </div>
      )}
      {run?.status === "failed" && (
        <div className="sg-empty">
          <h3>The analysis stopped</h3>
          <p>{run.error?.message ?? "Unknown error."} Earlier decisions are kept.</p>
          {analyze}
        </div>
      )}
      {run?.status === "complete" && candidates.length === 0 && (
        <div className="sg-empty">
          <h3>No reliable detections</h3>
          <p>Gemini found nothing it was confident about on this {site?.provider} image. Nothing was added to the checks.</p>
          {(() => {
            const res = (site?.scale as { native_resolution?: number } | null)?.native_resolution;
            return res && res >= 0.3 ? (
              <p>At {res} m per pixel a painted wheelchair symbol is only two or three pixels wide, too coarse to resolve. Count
                stalls on the Vexcel image with Mark stalls, or on site.</p>
            ) : null;
          })()}
        </div>
      )}

      {candidates.length > 0 && (
        <ul className="sg-list">
          {groups.map(([s, list]) => list.length > 0 && (
            <li key={s} className="sg-group">
              <h4>{s === "suggested" ? `To review (${list.length})` : `Confirmed (${list.length})`}</h4>
              <ul>{list.map(row)}</ul>
            </li>
          ))}
          {rejected.length > 0 && (
            <li className="sg-group">
              <button type="button" className="sg-toggle" aria-expanded={showRejected} onClick={() => setShowRejected(!showRejected)}>
                Rejected ({rejected.length})
              </button>
              {showRejected && <ul>{rejected.map(row)}</ul>}
            </li>
          )}
        </ul>
      )}

      {run?.status === "complete" && (
        <div className="sg-foot">
          {note && <p className="sg-note" role="status">{note}</p>}
          {candidates.length > 0 && (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy || (stalls.length === 0 && counted === 0)} onClick={apply}>
                Count {stalls.length} confirmed stall{stalls.length === 1 ? "" : "s"}
              </button>
              <p>Only confirmed accessible stalls become counts. Symbols, aisles and ramps stay as supporting evidence.</p>
            </>
          )}
          <details>
            <summary>What the model reported</summary>
            <p>{run.model}, {run.sdk}, image {run.image_width}×{run.image_height} px, {run.views?.length} views
              {run.rejected_boxes ? `, ${run.rejected_boxes} invalid box(es) discarded` : ""}.</p>
            <ul>{run.notes?.map((n) => <li key={n}>{n}</li>)}</ul>
          </details>
        </div>
      )}
    </div>
  );
}
