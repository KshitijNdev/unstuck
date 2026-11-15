// Local API port is 8173 here; scripts/dev.sh (8000) sets NEXT_PUBLIC_API_URL explicitly, which overrides this default.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8173";

export type FindingStatus =
  | "NUMERIC_SCREEN_FAIL"
  | "NUMERIC_SCREEN_PASS"
  | "SUSPECTED_VISUAL_BARRIER"
  | "FIELD_VERIFICATION_REQUIRED"
  | "INSUFFICIENT_DATA"
  | "OUT_OF_SCOPE";

export interface SourceStatus {
  provider: string;
  layer: "property" | "aerial" | "interior";
  state: "connected" | "limited" | "unavailable";
  is_sponsor_source: boolean;
  detail: string;
  features: string[];
}

export interface Region { id: string; label: string; x: number; y: number; w: number; h: number; kind: string }

export interface Pin { x: number; y: number; kind: "accessible" | "van"; candidate_id?: string | null; suggested?: boolean }
export interface StallSuggestion { x: number; y: number; kind: "accessible" | "van"; cue: string; confidence: "high" | "medium" }

export type CandidateCategory = "accessible_symbol" | "parking_stall" | "access_aisle" | "curb_ramp";

/** A Gemini visual suggestion. Box is 0-1 of the full image, top-left origin. Never a measurement. */
export interface Candidate {
  id: string;
  category: CandidateCategory;
  box: { x: number; y: number; w: number; h: number };
  confidence: "high" | "medium" | "low";
  note: string;
  view: string;
  status: "suggested" | "accepted" | "rejected";
  van?: boolean;
  original_category?: CandidateCategory;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

export interface AiRun {
  status: "running" | "complete" | "failed";
  progress?: { done: number; total: number; view: string } | null;
  model?: string;
  sdk?: string;
  image_width?: number;
  image_height?: number;
  views?: string[];
  rejected_boxes?: number;
  notes?: string[];
  candidates?: Candidate[];
  error?: { kind: string; message: string } | null;
  started_at?: string;
  finished_at?: string;
}

export const CATEGORY_LABEL: Record<CandidateCategory, string> = {
  accessible_symbol: "Accessible symbol",
  parking_stall: "Accessible stall",
  access_aisle: "Access aisle",
  curb_ramp: "Curb ramp",
};

export interface Evidence {
  id: string;
  provider: string;
  provider_asset_id: string | null;
  asset_type: string;
  capture_date: string | null;
  retrieved_at: string | null;
  view_url: string | null;
  geometry: { regions?: Region[]; summary?: Record<string, unknown>; pins?: Pin[]; pins_by?: string; ai?: AiRun } | null;
  scale: Record<string, unknown> | null;
  rights: string | null;
  quality: string | null;
  notes: string | null;
  is_synthetic: boolean;
  is_sponsor_source: boolean;
}

export interface Finding {
  id: string;
  rule_id: string;
  citation: string | null;
  title: string;
  location_id: string;
  location: string;
  required: { value: number; unit: string; condition?: string } | null;
  observed: {
    value: number; unit: string; method?: string | null;
    /** Scan doorways only: where the drawn opening puts this door in the measuring queue. Never a result. */
    triage?: "narrow" | "likely_narrow" | "measure" | "likely_wide";
    /** Scan doorways only: clear width a hinged door would leave, [low, high] in inches. An estimate. */
    clear_estimate_in?: [number, number];
    /** Scan doorways only: free gap measured at this doorway in the scan's 3D mesh, when it matched the floor plan. */
    mesh_gap_in?: number;
    /** Scan doorways only: lower-bound clear width a person may accept in place of measuring. */
    accept_clear_in?: number;
  } | null;
  status: FindingStatus;
  label: "measured" | "suspected" | "review needed";
  confidence: string;
  borderline: boolean;
  priority: number;
  rationale: string;
  followup: string;
  assumptions: string[];
  evidence_ids: string[];
  review_status: "NOT_REVIEWED" | "APPROVED" | "REJECTED" | "NEEDS_FIELD_VISIT";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note?: string | null;
  is_synthetic: boolean;
}

export const TRIAGE: Record<NonNullable<NonNullable<Finding["observed"]>["triage"]>, string> = {
  narrow: "Opening under 32 in",
  likely_narrow: "Measure first",
  measure: "Could go either way",
  likely_wide: "Likely wide enough",
};
export interface AgentEvent {
  seq: number;
  type: string;
  actor: string;
  tool: string | null;
  timestamp: string;
  summary: string;
  latency_ms: number | null;
  error_class: string | null;
  retry_count: number;
}

export interface Property {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  type: string | null;
  year_built: number | null;
  facilities: { id: string; label: string }[];
  doors: { id: string; label: string; model_id?: string | null }[];
  is_synthetic: boolean;
}

export interface ModelUsage {
  model: string;
  requests: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  est_cost_usd: number | null;
  price_note: string | null;
}

export interface UsageTotals {
  audits_with_agent: number;
  requests: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
  unpriced_models: string[];
}

export const getUsage = () => request<UsageTotals>("/api/usage");

export interface Measurement {
  id: string;
  location_id: string;
  name: string;
  value: number;
  unit: string;
  method: string;
  evidence_id: string | null;
  reviewed_by: string | null;
  notes: string | null;
  recorded_at: string;
}

export interface Audit {
  id: string;
  measurements: Measurement[];
  status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  engine: string;
  standard_profile: string;
  narrative: string | null;
  usage: ModelUsage[];
  is_synthetic: boolean;
  copied_from?: string | null;   // a featured screening this one copies; no provider was called for the copy
  started_at: string;
  plan: string[];
  data_availability: SourceStatus[];
  property: Property;
  evidence: Evidence[];
  findings: Finding[];
  events: AgentEvent[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  } catch {
    throw new Error(`Cannot reach the Unstuck API at ${API}. Is it running?`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : `Request failed (${res.status})`);
  }
  return res.json();
}

export interface CostarHit {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  type: string;
  year_built: number | null;
  surface_spaces: number | null;
  model_ids: string[];
  vexcel_region: string | null;   // Vexcel hackathon geofence the site falls in, or null if imagery would be refused
}

export const searchProperties = (q: string) =>
  request<{ properties: CostarHit[]; available: boolean; rights: string }>(
    `/api/properties/search?limit=12&q=${encodeURIComponent(q)}`,
  );

/** Configured means a key exists; only an explicit live check can make a provider verified or failed. */
export interface Integration {
  provider: "costar" | "vexcel" | "matterport" | "gemini" | "claude";
  role: string;
  state: "verified" | "configured" | "failed" | "unavailable";
  detail: string;
  checked_at: string | null;
  check_detail: string | null;
  model?: string;
  record_count?: number;
  ai_permitted?: boolean;   // Vexcel only: operator confirmed imagery may be sent to AI services
}

export const getSources = () =>
  request<{ sources: SourceStatus[]; integrations: Integration[]; engine: string; model?: string; engine_note: string; vexcel_ai_allowed?: boolean }>("/api/sources/status");
export const checkIntegration = (provider: Integration["provider"]) =>
  request<Integration>(`/api/integrations/${provider}/check`, { method: "POST" });
export const getAudit = (id: string) => request<Audit>(`/api/audits/${id}`);
export const createAudit = (body: unknown) =>
  request<{ audit_id: string }>("/api/audits", { method: "POST", body: JSON.stringify(body) });

/** A finished screening the operator pinned to the landing page. Counts match the action plan's three groups. */
export interface FeaturedAudit {
  id: string;
  name: string;
  address: string | null;
  type: string | null;
  year_built: number | null;
  started_at: string;
  completed_at: string | null;
  engine: string;
  is_synthetic: boolean;
  counts: { act: number; verify: number; passed: number };
  sources: string[];
}
export const getFeatured = () => request<{ audits: FeaturedAudit[] }>("/api/audits/featured");
/** Featured originals are read-only; opening one gives the visitor their own copy. No provider or AI call. */
export const copyAudit = (id: string) =>
  request<{ audit_id: string; copied_from: string }>(`/api/audits/${id}/copy`, { method: "POST" });

export interface PortfolioReason { code: "lot_unknown" | "large_lot" | "year_unknown" | "pre_ada" | "no_scan" | "no_aerial"; points: number; label: string }
/** One building before any screening: Table 208.2 minimums for the recorded surface spaces, and a measuring order. */
export interface PortfolioRow {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  type: string | null;
  year_built: number | null;
  surface_spaces: number | null;
  required_accessible: number | null;
  required_van: number | null;
  pre_ada: boolean;
  scans: number;
  vexcel_region: string | null;
  points: number;
  reasons: PortfolioReason[];
}
export interface Portfolio {
  owners: { id: number; buildings: number }[];
  owner: number | null;
  properties: PortfolioRow[];
  totals: { buildings: number; required_accessible: number; lot_unknown: number; pre_ada: number; no_scan: number; no_aerial: number };
  rights: string;
  available: boolean;
}
export const getPortfolio = (owner: number | null, q = "") =>
  request<Portfolio>(`/api/portfolio?${new URLSearchParams({ ...(owner != null ? { owner: String(owner) } : {}), q })}`);
export const addMeasurement = (id: string, body: unknown) =>
  request<unknown>(`/api/audits/${id}/measurements`, { method: "POST", body: JSON.stringify(body) });
export const saveMarkups = (id: string, pins: Pin[], reviewed_by: string, evidence_id?: string) =>
  request<unknown>(`/api/audits/${id}/markups`, { method: "POST", body: JSON.stringify({ pins, reviewed_by, evidence_id }) });
/** Optional Claude-vision suggestions. Server refuses restricted imagery without confirmed permission. */
export const suggestMarkups = (id: string) =>
  request<{ suggestions: StallSuggestion[]; notes: string | null }>(`/api/audits/${id}/markups/suggest`, { method: "POST" });
export const startAnalysis = (id: string, body: { evidence_id?: string; use_public_imagery?: boolean }) =>
  request<{ evidence_id: string; status: string }>(`/api/audits/${id}/analysis`, { method: "POST", body: JSON.stringify(body) });
export const reviewCandidate = (id: string, candidateId: string,
  body: { action: "accept" | "reject" | "relabel" | "reset"; reviewer: string; category?: CandidateCategory; van?: boolean }) =>
  request<Candidate>(`/api/audits/${id}/candidates/${candidateId}`, { method: "POST", body: JSON.stringify(body) });
export const applyCandidates = (id: string, evidence_id: string, reviewer: string) =>
  request<unknown>(`/api/audits/${id}/candidates/apply`, { method: "POST", body: JSON.stringify({ evidence_id, reviewer }) });
export const takeScanWidth = (id: string, doorId: string, door: "none" | "hinged", reviewed_by: string) =>
  request<unknown>(`/api/audits/${id}/doors/${encodeURIComponent(doorId)}/use-scan-width`,
    { method: "POST", body: JSON.stringify({ door, reviewed_by }) });
/** The number in a scan doorway's name ("Scan doorway 12, Floor 1" -> 12), or null for anything else. */
export const doorwayNumber = (location: string) => {
  const m = /^Scan doorway (\d+)/.exec(location);
  return m ? Number(m[1]) : null;
};
/** Inches the way the Matterport tour labels them, so a width here can be matched to the one on screen: 29.6 -> "2 ft 6 in". */
export const feetInches = (inches: number) => {
  const total = Math.round(inches);
  return total < 12 ? `${total} in` : `${Math.floor(total / 12)} ft ${total % 12} in`;
};
export const acceptScanEstimates = (id: string, reviewed_by: string) =>
  request<{ accepted: number }>(`/api/audits/${id}/doors/accept-scan-estimates`, { method: "POST", body: JSON.stringify({ reviewed_by }) });
export const getMatterportSdk = () =>
  request<{ available: boolean; application_key: string | null }>("/api/integrations/matterport/sdk");
export const chooseModel = (id: string, model_id: string) =>
  request<unknown>(`/api/audits/${id}/model`, { method: "POST", body: JSON.stringify({ model_id }) });
export const verifyFinding = (findingId: string, body: unknown) =>
  request<Finding>(`/api/findings/${encodeURIComponent(findingId)}/verify`, { method: "POST", body: JSON.stringify(body) });

/** Evidence URLs are either absolute (public sources) or API-relative (proxied sponsor imagery). */
export const evidenceUrl = (url: string) => (url.startsWith("/") ? `${API}${url}` : url);

export const STATUS: Record<FindingStatus, { icon: string; text: string; cls: string }> = {
  NUMERIC_SCREEN_FAIL: { icon: "✕", text: "Below minimum", cls: "bg-fail-bg text-fail border-fail" },
  NUMERIC_SCREEN_PASS: { icon: "✓", text: "Meets minimum", cls: "bg-pass-bg text-pass border-pass" },
  SUSPECTED_VISUAL_BARRIER: { icon: "?", text: "Possible barrier, not measured", cls: "bg-suspect-bg text-suspect border-suspect" },
  FIELD_VERIFICATION_REQUIRED: { icon: "◌", text: "Measurement needed", cls: "bg-review-bg text-review border-review" },
  INSUFFICIENT_DATA: { icon: "–", text: "Not enough data", cls: "bg-review-bg text-review border-review" },
  OUT_OF_SCOPE: { icon: "–", text: "Out of scope", cls: "bg-review-bg text-review border-review" },
};

export const CONFIDENCE: Record<string, string> = {
  DEMO_SYNTHETIC: "Synthetic demo value",
  FIELD_MEASURED: "Measured on site",
  MANUAL_ENTRY: "Counted or entered by a person",
  MODEL_METRIC: "Measured in the 3D scan",
  SCAN_MESH_ACCEPTED: "Scan estimate, accepted by a person",
  PROPERTY_RECORD: "From property record",
  IMAGE_ESTIMATE_UNVERIFIED: "Image estimate, not verified",
  VISUAL_UNVERIFIED: "Seen in imagery, not measured",
  NO_MEASUREMENT: "No measurement",
  SCAN_FLOORPLAN: "Matterport floor plan (frame opening)",
};
