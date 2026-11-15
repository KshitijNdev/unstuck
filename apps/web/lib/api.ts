// The local API runs on 8173 (see START_UNSTUCK_SPATIAL.command); NEXT_PUBLIC_API_URL overrides it.
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

export interface Pin { x: number; y: number; kind: "accessible" | "van"; candidate_id?: string | null }

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
  observed: { value: number; unit: string; method?: string | null } | null;
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
  doors: { id: string; label: string }[];
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
  narrative: string | null;
  usage: ModelUsage[];
  is_synthetic: boolean;
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
}

export const getSources = () =>
  request<{ sources: SourceStatus[]; integrations: Integration[]; engine: string; engine_note: string }>("/api/sources/status");
export const checkIntegration = (provider: Integration["provider"]) =>
  request<Integration>(`/api/integrations/${provider}/check`, { method: "POST" });
export const getAudit = (id: string) => request<Audit>(`/api/audits/${id}`);
export const createAudit = (body: unknown) =>
  request<{ audit_id: string }>("/api/audits", { method: "POST", body: JSON.stringify(body) });
export const addMeasurement = (id: string, body: unknown) =>
  request<unknown>(`/api/audits/${id}/measurements`, { method: "POST", body: JSON.stringify(body) });
export const saveMarkups = (id: string, pins: Pin[], reviewed_by: string, evidence_id?: string) =>
  request<unknown>(`/api/audits/${id}/markups`, { method: "POST", body: JSON.stringify({ pins, reviewed_by, evidence_id }) });
export const startAnalysis = (id: string, body: { evidence_id?: string; use_public_imagery?: boolean }) =>
  request<{ evidence_id: string; status: string }>(`/api/audits/${id}/analysis`, { method: "POST", body: JSON.stringify(body) });
export const reviewCandidate = (id: string, candidateId: string,
  body: { action: "accept" | "reject" | "relabel" | "reset"; reviewer: string; category?: CandidateCategory; van?: boolean }) =>
  request<Candidate>(`/api/audits/${id}/candidates/${candidateId}`, { method: "POST", body: JSON.stringify(body) });
export const applyCandidates = (id: string, evidence_id: string, reviewer: string) =>
  request<unknown>(`/api/audits/${id}/candidates/apply`, { method: "POST", body: JSON.stringify({ evidence_id, reviewer }) });
export const chooseModel = (id: string, model_id: string) =>
  request<unknown>(`/api/audits/${id}/model`, { method: "POST", body: JSON.stringify({ model_id }) });
export const verifyFinding = (findingId: string, body: unknown) =>
  request<Finding>(`/api/findings/${encodeURIComponent(findingId)}/verify`, { method: "POST", body: JSON.stringify(body) });

/** Evidence URLs are either absolute (public sources) or API-relative (proxied sponsor imagery). */
export const evidenceUrl = (url: string) => (url.startsWith("/") ? `${API}${url}` : url);

export const STATUS: Record<FindingStatus, { icon: string; text: string; cls: string }> = {
  NUMERIC_SCREEN_FAIL: { icon: "✕", text: "Below threshold", cls: "bg-fail-bg text-fail border-fail" },
  NUMERIC_SCREEN_PASS: { icon: "✓", text: "Meets threshold", cls: "bg-pass-bg text-pass border-pass" },
  SUSPECTED_VISUAL_BARRIER: { icon: "?", text: "Suspected, unmeasured", cls: "bg-suspect-bg text-suspect border-suspect" },
  FIELD_VERIFICATION_REQUIRED: { icon: "◌", text: "Needs field measurement", cls: "bg-review-bg text-review border-review" },
  INSUFFICIENT_DATA: { icon: "–", text: "Not enough data", cls: "bg-review-bg text-review border-review" },
  OUT_OF_SCOPE: { icon: "–", text: "Out of scope", cls: "bg-review-bg text-review border-review" },
};

export const CONFIDENCE: Record<string, string> = {
  DEMO_SYNTHETIC: "Synthetic demo value",
  FIELD_MEASURED: "Field measured",
  MANUAL_ENTRY: "Manually entered",
  MODEL_METRIC: "Measured in 3D tour",
  PROPERTY_RECORD: "From property record",
  IMAGE_ESTIMATE_UNVERIFIED: "Unverified image estimate",
  VISUAL_UNVERIFIED: "Visual only, unverified",
  NO_MEASUREMENT: "No measurement",
};
