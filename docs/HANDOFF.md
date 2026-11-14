# UNSTUCK — Complete Product, Engineering, Data and Hackathon Handoff

**Version:** 1.0 · **Prepared:** 14 November 2026 · **Status:** prototype / sponsor-data integration pending  
**Project owner:** Hackathon team · **Track:** Business & Enterprise (verify current official submission rules)  
**One-line pitch:** *Unstuck uses property records, aerial imagery and 3D building evidence to screen commercial properties for possible accessibility barriers, locate those barriers visually, and prioritize human-verifiable improvements.*

> **Non-negotiable claim discipline:** Unstuck is an **accessibility screening and evidence-management tool**, **not** a certified ADA inspection, a legal compliance determination, or a substitute for a California CASp, Texas RAS, qualified accessibility consultant, or field measurements. Never label an unverified visual guess a confirmed code violation.

---

## 0. Executive decision and present-state truth

**Go** on a **single-property, evidence-backed prototype**. **Do not** promise fully automated ADA compliance assessment until data access and measurement accuracy are demonstrated. Target one real, authorized commercial property in Los Angeles or Houston where at least two sponsor data layers overlap; three layers are preferred. Design the system so absent data produces `UNVERIFIED` findings rather than invented measurements.

**Existing artifact:** `unstuck_starter.zip` (companion starter). Extract to get `app.py`, `index.html`, `rules.py`, `test_rules.py`, `README.md`. Run `python -m unittest -v test_rules.py` followed by `python app.py`, then open `http://localhost:8000`. The starter is a local UI and Python deterministic rules sandbox: public USGS imagery, public example Matterport viewer, manually entered **synthetic** measurements. Its Matterport tour is **not the building represented by the sample aerial view**. It has **no** CoStar integration, Vexcel login, property data join, real automated door measurement, vision analysis or actual violation detection. Do not describe these as completed.

**Verified in public provider documentation (not authorized hackathon access):**
- Matterport Model API GraphQL: `https://api.matterport.com/api/models/graph`; token ID/secret required. Model API generally available with account; Property Intelligence dimensional data is **Enterprise-tier** and access depends on account and model.
- Vexcel MCP endpoint: `https://api.vexcelgroup.com/v2/mcp`; authorized API key is required. Product availability, location coverage, image rights and quotas must be tested.
- Deep Agents exposes `create_deep_agent`, custom tools, MCP integration, subagents and built-in work planning.
- Official 2010 ADA Standards are published at ADA.gov; legal application varies by construction/alteration history, facility, exceptions and state rules.

**Not verified:** credentials, actual CoStar API format/coverage, a property having all three datasets, doorway clear-width extraction, Vexcel pixels available for a sample address, tax savings for any owner, current prize/deadline specifics.

## 1. Problem, user and user journey

### 1.1 Target users
- **Primary:** commercial landlord, retail/restaurant portfolio owner, facilities/property manager.
- **Secondary:** due-diligence manager, accessibility consultant using a triage tool.
- **Not primary:** serial plaintiffs or bulk discovery of public-facing businesses to target with claims. Portfolio mode is **restricted to properties a user owns or is authorized to audit**.

### 1.2 User job
“Tell me which parts of my property could prevent people from accessing it, what evidence supports that concern, what needs field verification, what to tackle first, and the rough planning cost.”

### 1.3 MVP journey
1. Select a known demo property or enter an authorized commercial building address.
2. Resolve address + rooftop/parcel geometry; display **data coverage** and imagery date.
3. Press **Start screen**; see live audit plan / tool events.
4. Property agent fetches use, construction year, parking facility count, ownership scope; marks missing inputs.
5. Exterior inspector retrieves lawful aerial/oblique media and creates suspected parking/entrance observations with polygons; human confirms stall counts where needed.
6. Interior inspector loads permitted Matterport model/tour and any available dimensional data; if only viewer exists, prompt for field/manual measured doorway width instead of guessing.
7. Pure Python rules evaluate structured **measurements** (not unstructured LLM prose).
8. Report contains issue priority, evidence link/pin, numerical requirement, uncertainty, recommended human validation, ballpark repair planning range.
9. User exports branded PDF/JSON and sees an audit trail.

### 1.4 Success criteria for weekend
- Real, correctly matched data for **one** accessible authorized property; at least two provider layers for sponsor track if the official rules require that.
- One visual issue with a click-to-evidence action, one tested deterministic ADA check, and a clear distinction between **measured / suspected / needs field review**.
- Graceful behavior when private source is missing or rate-limited.
- Demo works with captured, **licensed and permitted** snapshots, provenance preserved, and a visible live-mode toggle.
- Agent actions and delegation demonstrable, rather than a chat wrapper on one property record.

## 2. Scope and guardrails

### In MVP
Property resolution; record retrieval; one exterior parking audit; one door clearance audit where measurement is trustworthy or manually entered; evidence links; review workflow; agent timeline; prioritized findings; export.

### Stretch
Matterport 3D coordinates and interactive tags; multi-property authorized portfolio mode; route geometry; curb ramps; clearance segmentation; repair-cost estimator with sourced assumptions; tax incentive eligibility questionnaire.

### Deliberately out of MVP
Certification of ADA compliance; automated legal conclusions; claims that oblique pictures prove ramp grade/handrail dimensions/door opening force; statewide Title 24 or TAS compliance coverage; real net-of-tax renovation costs without facts; all-building crawl of a zip code.

## 3. Data acquisition and licensing matrix

| Layer | Primary source | What it can contribute | Authentication / blocker | Fallback | Verification pass condition |
|---|---|---|---|---|---|
| Commercial property | **CoStar hackathon toolkit** | building ID/address, type, year, floor area, parking, owner/tenant metadata if licensed | sponsor-only credentials and schemas **unknown** | LA County Assessor, Harris Central Appraisal District | fetch one real property, legal use confirmed, stable ID, field provenance |
| Aerial / oblique | **Vexcel MCP/API** | imagery, orthographic and oblique perspective, possible structure metadata / DSM/DTM | valid Vexcel key + product entitlement + coverage | USGS NAIP/other authorized government aerials | image for **same property**, pixel/scale metadata and capture date |
| Interior 3D | **Matterport Model API + Viewer/Showcase SDK** | authorized tour, rooms/floors, possibly dimensional estimates, available spatial data and tags | account/model rights, PI Enterprise-tier; openings may not include usable clear width | permitted viewer + manual measurement; venue-provided floor plan | actual tour **same property**, allowed embedding; test measured door width against tape measure |
| Rules | **2010 ADA Standards / Access Board** | dimensional criteria and citations | public, but legal applicability must be reviewed | none | every implemented rule has statute section, unit tests and assumptions |
| Optional economics | local contractor estimates, IRS primary sources | planning cost bands, possible tax eligibility | estimates unreliable without scope/site context | omit net-cost | price assumptions labeled and attributable; eligibility not presumed |

**Official starting links:**  
CoStar: https://www.costar.com/ (request hackathon-specific docs from staff; do not invent an endpoint).  
Vexcel: https://vexceldata.com/platform/vexcel-mcp/mcp-get-started/  
Matterport Model API: https://developers.matterport.com/api/model/overview/  
Matterport PI: https://developers.matterport.com/api/property-intelligence/  
Matterport SDK: https://developers.matterport.com/  
USGS image service: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer  
HCAD: https://hcad.org/pdata/pdata-property-downloads.html  
LA County Open Data: https://data.lacounty.gov/  
ADA.gov: https://www.ada.gov/law-and-regs/design-standards/2010-stds/  
Deep Agents: https://reference.langchain.com/python/deepagents/graph/create_deep_agent

### 3.1 Sponsor engineer questions (ask before coding integrations)
1. Which **commercial** building has a CoStar ID, Vexcel imagery and an authorized Matterport tour in the *same place*?
2. Provide one documented request/response example, authentication method, scope/quotas and allowed uses for each service.
3. For Matterport, can our keys query `dimensionalEstimates`, `rooms`, `floors`, `Opening` and measurements? Is Property Insights enabled? Is **clear opening width** obtainable or only room/wall/opening bounding geometry?
4. Does Vexcel key return nadir imagery, oblique imagery, DSM/DTM, georeferencing, orthophoto resolution, acquisition timestamp? Are image exports and temporary caches allowed?
5. Can we show sponsor imagery/scans publicly on Devpost, in a YouTube demo, and store screenshots locally? What attribution is required?
6. Can CoStar records be joined to authorized Matterport model IDs? Is a crosswalk exposed or must we obtain mapping from organizers?
7. Are parking counts per lot, per property, shared or off-site? Are tenant classifications reliable?
8. What are official event submission requirements, track eligibility, scoring rules, SDK constraints and deadline?

### 3.2 Data identity: prevent dangerous mismatches
Every observation must carry `property_id`, `source`, `source_record_id`, `retrieved_at`, `capture_date`, `coordinate_reference_system`, `geometry`, and `rights` where relevant. Match by parcel footprint/geocoordinates + normalized civic address + provider ID, then **human-confirm** the match. Two sources having similar addresses is insufficient: suites, adjacent parking, parking structures and mixed-use parcels create false joins.

## 4. Recommended implementation architecture

```
Next.js 15+ / TypeScript / Tailwind
  ├─ /properties search and data coverage
  ├─ /audits/[id] plan timeline, aerial+3D evidence viewer
  ├─ /audits/[id]/report findings and export
  └─ Review controls / source provenance / manual measurements
           |
           | HTTPS JSON / optional server-sent events (SSE)
           v
Python FastAPI
  ├─ POST /api/audits                 create a new audit job
  ├─ GET  /api/audits/{id}            status/summary
  ├─ GET  /api/audits/{id}/events     plan/tool trace SSE
  ├─ GET  /api/audits/{id}/findings   structured issues
  ├─ POST /api/findings/{id}/verify   reviewer action
  ├─ GET  /api/audits/{id}/export     PDF or JSON
  └─ /health, /api/sources/status
           |
           v
Deep Agents (orchestrator + property, exterior, interior, reporting subagents)
  ├─ CoStar adapter    → private provider API/MCP; local fixtures
  ├─ Vexcel adapter    → MCP; authorized imagery
  ├─ Matterport adapter→ GraphQL and viewer SDK bridge
  ├─ Vision adapter    → images → proposed geometry + observations
  ├─ Rule engine       → deterministic numeric results
  └─ Review queue      → unresolved uncertain observations
           |
           v
SQLite (weekend) → PostgreSQL + PostGIS (future)
Filesystem/object storage (fixture snapshots, media references, NOT unlicensed images)
```

**Why two services?** Next.js gives polished UI and maps; FastAPI supports Python rules and Deep Agents without JS/Python bridge hacks. For shortest MVP, retain the pure-Python starter until one full audit exists. Avoid early infra complexity, queues, Kubernetes and vector databases.

**Primary languages/libraries:** TypeScript, React, Tailwind, MapLibre or Leaflet for geospatial overlays, Matterport SDK; Python 3.11+, FastAPI, Pydantic 2, httpx, pytest, deepagents, LangChain MCP adapters, Pillow/OpenCV (optional), shapely/pyproj (optional). For vision use a hackathon-approved image-capable model. Pin package versions from actual tested lockfile instead of copying unvalidated version strings.

## 5. Canonical data model and API contracts

### 5.1 Data entities
- **Property**: `id`, `address`, `city`, `state`, `lat`, `lon`, `parcel_geometry`, `type`, `year_built`, `facilities[]`, `ownership_authorized`, `source_refs[]`.
- **Audit**: `id`, `property_id`, `standard_profile`, `status`, `started_at`, `completed_at`, `data_availability`, `plan`, `agent_events[]`.
- **Evidence**: `id`, `property_id`, `provider`, `provider_asset_id`, `asset_type`, `capture_date`, `retrieved_at`, `view_url`, `geometry`, `scale`, `rights`, `quality`, `notes`.
- **Measurement**: `name`, `value`, `unit`, `method` (`field`, `model_metric`, `manual`, `image_estimate`), `uncertainty`, `evidence_id`, `reviewed_by`.
- **Finding**: `id`, `property_id`, `audit_id`, `rule_id`, `location`, `required`, `observed`, `status`, `severity`, `confidence`, `rationale`, `evidence_ids`, `followup`, `remediation`, `cost_range`, `review_status`.

### 5.2 Finding states (never conflate)
- `NUMERIC_SCREEN_FAIL`: sufficient trusted structured measurement fails a dimensional rule; **not** yet legal determination.
- `NUMERIC_SCREEN_PASS`: sufficient trusted measurement meets tested numeric threshold; not comprehensive compliance.
- `SUSPECTED_VISUAL_BARRIER`: model or reviewer sees a candidate barrier, but no valid dimensions.
- `FIELD_VERIFICATION_REQUIRED`: key measurement, design context or legal applicability missing.
- `INSUFFICIENT_DATA`: source unavailable or identity/scale unreliable.
- `OUT_OF_SCOPE`: standard or facility applicability not supported.

### 5.3 Example finding (fixture, NOT observed at a real property)
```json
{
  "id": "finding_demo_001",
  "audit_id": "audit_demo_001",
  "property_id": "property_demo_001",
  "rule_id": "ADA_2010_404_2_3",
  "title": "Entrance doorway may be too narrow",
  "required": {"value": 32, "unit": "in", "condition": "depth <= 24 in"},
  "observed": {"value": 30, "unit": "in", "method": "synthetic_demo_only"},
  "status": "NUMERIC_SCREEN_FAIL",
  "confidence": "DEMO_SYNTHETIC",
  "evidence_ids": [],
  "review_status": "NOT_REVIEWED",
  "legal_compliance_determination": false,
  "recommended_action": "Measure clear opening with door open 90 degrees; request professional review before renovation"
}
```

### 5.4 Example endpoint requests
`POST /api/audits`:
```json
{"property_id":"property_demo_001","mode":"single_property","standard_profile":"ADA_2010_SCREEN","allow_synthetic_fixture":true}
```
Response `202 Accepted`:
```json
{"audit_id":"audit_demo_001","status":"QUEUED","status_url":"/api/audits/audit_demo_001"}
```
**Production guard:** `allow_synthetic_fixture` is disabled and the UI must label fixture/demo mode. No unreviewed AI request can approve a real legal finding.

## 6. Deterministic standards engine and caveats

Always source rules directly from https://www.ada.gov/law-and-regs/design-standards/2010-stds/ and store references. Distinguish **numeric dimensional screening** from **whether the standard applies** to the building and whether a barrier must be removed at that time.

### 6.1 Initial rule inventory
| Check | Starter numeric rule / trigger | Standard | Input quality needed |
|---|---|---|---|
| Accessible parking count | 1–25:1; 26–50:2; 51–75:3; 76–100:4; 101–150:5; 151–200:6; 201–300:7; 301–400:8; 401–500:9; 501–1000: 2% rounded up; >1000: 20 + 1 per 100 or fraction above 1000 | §208.2 | per-facility total, facility type, exceptions |
| Van spaces | At least 1 van-accessible space for each 6 accessible spaces or fraction | §208.2.4 | marked/classified count |
| Special parking | Certain hospital outpatient facilities: 10%; certain rehab/outpatient physical therapy: 20% | §208.2.1, 208.2.2 | **actual facility use**, scope reviewed |
| Door clear opening | 32 in, or 36 in for doorway opening >24 in deep; swinging door measured open 90° | §404.2.3 | *clear width*, not frame/bounding-box width |
| Accessible walking route | Typically 36 in clear; limited 32-in pinch for max 24 in with separation requirements and exceptions | §403.5.1 | geometry and special conditions |
| Walking route slope | Running <= 1:20; cross <= 1:48 | §403.3 | field-grade measurement, not rough elevation raster |
| Ramp running slope | Generally <= 1:12, with specific exceptions/context | §405.2 | field-grade measurements + rise/run |
| Ramp handrails | Generally required for ramp runs with rise >6 in; both sides with listed exceptions | §§405.8, 505 | field/view + context |
| Parking bay dimensions | Standard vehicle space >=96 in; van option >=132 in or >=96 in with >=96 in aisle; aisle >=60 in generally | §502.2, §502.3 | scaled measured geometry; avoid guess from coarse imagery |

**Notable legal nuance:** §208 counts per parking facility (not necessarily aggregate entire parcel); multiple facilities require separate calculations. Existing facilities, safe harbors, alterations, structural impracticability, local California Title 24/Texas TAS rules, public accommodation applicability, and the readily-achievable test cannot be resolved just from aerial photos. Need professional interpretation.

### 6.2 Standard engine signature
```python
def check_door(clear_width_in: float | None,
               opening_depth_in: float | None,
               measurement_method: str,
               evidence_id: str | None) -> dict:
    # None or model-image estimates WITHOUT calibrated evidence -> FIELD_VERIFICATION_REQUIRED
    # Else compare against 32/36 and include rule citation and measurement provenance
    ...
```
Never add `0` as a default when a value is missing. Never silently convert approximate pixel widths into ADA pass/fail. Record uncertainty and force review near thresholds. Keep tests in `tests/test_rules.py` with all threshold boundaries and exception branches.

### 6.3 Cost and tax section
Repair estimates are **planning bands**, not contractor bids. Price sources, geography, assumed dimensions, materials, permits, scope and confidence must be stored. Tax credits/deductions **cannot** be simply subtracted dollar-for-dollar from project estimates. IRC §44 credit depends on eligibility and eligible expenditure calculations; IRC §190 deduction is a deduction, not a cash rebate. Present “potential tax programs to discuss with an accountant,” not a fictitious 'net cost'. Confirm current IRS source before demo; do not infer eligibility from a CoStar property record.

## 7. Agent design (real agentic depth, bounded authority)

### 7.1 Orchestrator
Use `create_deep_agent`. The orchestrator owns a visible task plan, data coverage checks, delegation, evidence reconciliation, uncertainty management and final output. Built-in task tracking and tool/subagent traces are your proof of agentic work. Subagents must have **read-only** provider tools; no mutation to a sponsor source unless user expressly authorizes it.

**Prompts/contracts:**
- **Property investigator:** resolve IDs, land use, year, parking counts. Report `UNKNOWN` rather than fabricating.
- **Exterior inspector:** list possible accessible stalls, aisles, obstructions, routes; return georeferenced polygons and image citations; no slope/width proof without survey-grade input.
- **Interior inspector:** fetch authorized tour and supported measurements; distinguish room dimensions, opening geometry and actual door clear width; output spatial model coordinates only if provider confirms coordinate conventions.
- **Rules evaluator:** call deterministic function; never change numeric outputs.
- **Report author:** summarize evidence and actions, prioritize human accessibility benefit + verified issue severity + practicability; do not provide legal rulings, unsupported ROI or exact tax savings.

### 7.2 Control loop
```
INPUT -> CONFIRM OWNERSHIP/RIGHTS -> RESOLVE PROPERTY
  -> PLAN -> CHECK SOURCE COVERAGE
  -> PARALLEL PROPERTY / EXTERIOR / INTERIOR INVESTIGATION
  -> NORMALIZE + CROSSCHECK PROPERTY IDENTITIES
  -> EXTRACT MEASUREMENTS OR UNVERIFIED HYPOTHESES
  -> DETERMINISTIC ADA SCREEN
  -> REVIEW QUEUE FOR UNCERTAIN FINDINGS
  -> EVIDENCE-BACKED REPORT + AUDIT TRAIL
```

### 7.3 Minimum event log
`PLANNED`, `FETCH_STARTED`, `FETCH_SUCCESS`, `FETCH_FAILURE`, `SOURCE_MISSING`, `OBSERVATION_PROPOSED`, `RULE_EVALUATED`, `REVIEW_REQUESTED`, `FINDING_APPROVED`, `REPORT_READY`. Include actor/tool, timestamp, property ID, source ID, payload hash, latency, error class and retry count. Do **not** log API keys, bearer headers, sensitive customer identity or raw tokens.

### 7.4 Failure behavior
Timeout → retry with capped exponential backoff → use consented cached asset with age label → degrade to manual evidence input → report missing source. Do not replace an inaccessible CoStar or Vexcel image with an arbitrary public image while implying it is the same property.

## 8. Vision pipeline and image-grounding requirements

1. Load legally licensed imagery and metadata.
2. Verify CRS, orthorectification and local pixel scale before overlay measurements.
3. Detect parking lot ROI and proposed stall polygons (manual marking first, vision-assisted second).
4. Classify marked accessible spaces, van signage, striped aisles as **candidate labels**; confidence cannot replace measurement.
5. A human confirms facility boundary, number of stalls, and ambiguous markings.
6. Crosscheck CoStar parking total against actual counted stalls; if mismatch, show both and request resolution. Avoid mixing a property-wide parking count with a single lot.
7. Generate screen checks only when confidence and source quality permit; otherwise `FIELD_VERIFICATION_REQUIRED`.

**3D pipeline:** authorized Matterport model ID → if allowed, scene SDK and model metadata → retrieve dimensions → map observation to Matterport coordinate frame → pin via documented SDK API → test click/fly-to on one model. If no access, use a screenshot or permitted public tour and **manually located annotation**; show as mock UI not a verified geospatial finding.

**Accuracy policy:** a door opening geometry estimate or room width is not equivalent to clear width with the leaf open 90°. Image-based ramp slope estimates are generally insufficient for regulatory pass/fail. Date and resolution must be visible in UI.

## 9. UX specification

**Design direction:** bright, human-centered, clear “unsticking” journey. Accessible interface itself: keyboard navigation, semantic labels, discernible link text, strong contrast, readable legend, non-color-only severity, reduced motion, alt text for imagery, screen-reader accessible issues list.

**Screen A: Welcome / address** — punchy name, address picker, authorized-property gate, mock/demo selector, **Start screening**.

**Screen B: Data coverage** — CoStar / Vexcel / Matterport cards: `Connected`, `Limited`, `Unavailable`; date, feature set, match confidence. Block misleading “ready” status if cross-source identity unconfirmed.

**Screen C: Live agent activity** — steps and specialist assignments, timestamped tools and rationale (brief action summaries; do not expose internal hidden reasoning), retry state and human confirmation requests.

**Screen D: Split evidence** — aerial map overlay left, 3D tour right, findings drawer below/side; click finding highlights evidence and, when spatially grounded, moves tour viewpoint. Use neutral pins for uncertain; stronger alert styles only after measurement review.

**Screen E: Findings** — cards with location, status, requirement, measured value + method, confidence, source/capture timestamp, reviewer, priority, next action and rule link.

**Screen F: Action plan / export** — prioritize route access/entry/parking and essential access, then interior issues. Show cost ranges with source assumptions; owner-friendly summary, caveats, print/PDF, machine-readable JSON.

## 10. Repository layout (target, not currently implemented)

```
unstuck/
  README.md
  .env.example
  apps/web/
    app/page.tsx
    app/properties/[id]/page.tsx
    app/audits/[id]/page.tsx
    components/AddressSearch.tsx
    components/DataCoverage.tsx
    components/AgentTimeline.tsx
    components/AerialEvidenceMap.tsx
    components/MatterportViewer.tsx
    components/FindingPanel.tsx
    lib/api.ts
  services/api/
    app/main.py
    app/models.py
    app/routes/audits.py
    app/agents/orchestrator.py
    app/agents/property.py
    app/agents/exterior.py
    app/agents/interior.py
    app/agents/report.py
    app/providers/costar.py
    app/providers/vexcel.py
    app/providers/matterport.py
    app/providers/usgs.py
    app/rules/ada2010.py
    app/rules/standards.py
    app/report/generator.py
    tests/test_ada_rules.py
    tests/test_source_identity.py
    tests/test_api_contracts.py
    tests/fixtures/authorized_demo_property.json
  docs/
    HANDOFF.md
    DATA_ACCESS_CHECKLIST.md
    DEMO_SCRIPT.md
    CLAIMS_AND_LIMITATIONS.md
```

**Environment keys (never commit):** `COSTAR_API_KEY` / actual organizer-defined format; `VEXCEL_API_KEY`; `MATTERPORT_TOKEN_ID`, `MATTERPORT_TOKEN_SECRET`; `MODEL_API_KEY`; `DATABASE_URL`; optional `DEMO_FIXTURE_MODE=true`. Include `.gitignore` and `.env.example` without real credentials.

## 11. Implementation sequence with developer owners and acceptance tests

### P0 — Access and truthfulness (first block)
- Obtain organizer-approved data access and allowed publication/caching terms.
- Retrieve one building record, aerial image and 3D model **or show precise unavailability**.
- Manually match the building across providers and capture source identifiers.
**Accept:** one source manifest JSON with common property ID, each source's provider ID, date, accessible features and rights. If no overlap, choose parking-only fallback immediately.

### P1 — Rule engine (parallel)
- Refactor current `rules.py` into typed rules with provenance, states and input validation.
- Implement parking facility count, van count, door clear width, route width, and missing-data semantics.
- Write boundary tests (25/26, 50/51, 75/76, 500/501, 1000/1001; 31.99/32; 24/24.01 depth; special lots; unknown values; multi-facility sum only after per-facility).
**Accept:** all tests green; zero LLM math decisions.

### P2 — API and fixtures
- FastAPI `POST /audits`, `GET /audits/{id}`, events, findings, review, export.
- Write at least one **clearly labeled synthetic** fixture and one source-manifest fixture.
- Add source adapters with normalized `Property`, `Evidence`, `Measurement` output.
**Accept:** no hard-coded sponsor secret; integration tests use fixtures; one reproducible audit from command line.

### P3 — Agent pipeline
- Set up Deep Agents with explicit subagents and tool allowlists.
- Log plan and tool events. Normalize structured outputs and validate with Pydantic before rule evaluation.
- Enforce data provenance; unknown measurement → review queue.
**Accept:** agent visibly calls >=2 different provider/rules tools, delegates at least one task, handles a failed provider, delivers a grounded report.

### P4 — Killer demo UX
- Implement responsive dashboard, data coverage, interactive aerial overlay and issue list.
- If authorized Matterport spatial SDK works: tags/fly-to for one real issue; else use an unmistakably labeled demo annotation.
- Show source capture date + label `measured`, `suspected`, or `review needed` prominently.
**Accept:** a judge can enter/select a property, start, click one issue and see its evidence in <2 minutes.

### P5 — Submission
- Document integration architecture, data rights, what is real vs simulated, limitations, rule sources, demo commands.
- Record short video and screenshots with no unlicensed/private material.
- Validate current event rules, tracks, opt-ins, submission fields and deadline from official organizer portal.
**Accept:** cold-start on another machine, no API key leak, local fixture demo works without live calls, 2-minute demo rehearsal complete.

## 12. Testing / QA matrix

**Unit:** parking row boundaries; van rounding; multi-lot logic; measured opening 90° assumptions; unknowns; units; unsupported standard profiles; numeric threshold handling.

**Integration:** valid and invalid credentials; rate limit; missing Matterport model; mismatched addresses; Vexcel coverage empty; imagery attribution; preview URL access; REST/GraphQL error handling; sponsor API timeout.

**Human validation:** compare one parking count with manual mark-up; verify all aerial annotations lie on correct parcel; manually measure one door; compare any 3D estimate with human measurement; field-review grades cannot be auto-upgraded.

**UI:** keyboard-only navigation; responsive split view; issues still accessible when external iframe blocked; map coordinate overlay stable at zoom; no click into unrelated Matterport scene; color-independent statuses.

**Security:** no API tokens to browser; server-side proxy for privileged APIs; use signed URLs if authorized; restrict cross-origin access; rate-limit address audits; scrub logs; permission-check portfolio mode; preserve and observe usage rights.

**Demo:** run offline/slow internet simulation; reset state; verify all fixture data visibly marked; keep a prepared screen recording if live services fail; do not present recorded results as real-time API responses.

## 13. Portfolio mode (only after single-property success)

Input: *my authorized list* of property IDs or user-supplied addresses, not arbitrary “find vulnerable businesses”. Orchestrator determines data coverage, allocates inspection budgets, processes buildings sequentially or bounded parallel, and ranks **review priority** based on evidence quality, public access importance, known measurements, and practical impact. Never publish a map targeting third-party properties without authorization.

Constraints: provider quotas, fairness, privacy, anti-abuse, and non-discriminatory facility evaluation; owner access confirmation; no spurious “risk scores” for venues with no data. Label `not enough evidence` rather than low risk.

## 14. Demo script (90–120 seconds)

**0–15s — The pain:** “Most owners don't know where accessibility barriers are until a renovation, complaint or paid inspection. Unstuck surfaces what should be checked first.”

**15–30s — Real data:** Choose one verified property, show provider data coverage and capture dates. Clearly differentiate sponsor sources from fallbacks.

**30–50s — Agent works:** Click Audit. Show plan, CoStar lookup, Vexcel image retrieval, Matterport dimension check (if authorized), and deterministic ADA evaluation. A failed source should gracefully degrade.

**50–80s — The wow:** Click a **verified or clearly tentative** finding. Aerial region highlights; Matterport tour focuses on exact location if spatial mapping is real; rule and source measurements appear in one card.

**80–100s — Action:** Show field verification next step, recommended repair class, estimated planning range (if sourced) and owner-friendly export.

**100–120s — Close:** “Unstuck turns scattered building information into a clear accessibility action plan. Screening, not certification.”

## 15. Contingency decision tree

- **All three datasets + measured openings:** full two-pane 3D + aerial integrated demo; prioritize making one issue rock-solid.
- **CoStar + Vexcel, Matterport view only:** real aerial parking agent + property data + 3D contextual viewer; manual door measurement, no false 3D precision.
- **CoStar + Matterport, no Vexcel:** interior access screening, property context; map available imagery only as context.
- **Vexcel only (and public assessor):** parking accessibility triage MVP; do not claim official CoStar track requirement met until confirmed.
- **Only public datasets:** transparent proof-of-concept; may not qualify for CoStar prize; continue only if submission track accepts it.
- **No real measurements:** demonstrate candidate detection + human confirmation + deterministic result on labeled sample inputs, not automated compliance.

## 16. Risks and mitigation owners

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Sponsor key delayed | High / Critical | public fixtures + ask engineer for one prelinked demo property |
| No common property | High / Critical | choose source overlap first; narrow scope |
| Matterport openings gated | High / High | build manual input path, use viewer contextual only |
| Aerial cannot support inch-scale sizes | High / High | counts/markup first, verified field measurements for dimensions |
| Wrong legal applicability | Medium / Critical | professional caveat, rule profile, source citations and review |
| Cost/tax exaggeration | Medium / High | remove “net cost”; sourced ranges and eligibility disclaimer |
| Agent invents values | High / Critical | schema validation, provenance requirement, `None` and `UNKNOWN` |
| Demo API outage | Medium / High | permitted snapshots + offline labeled fixture |
| API terms prohibit screenshots | Unknown / High | confirm redistribution, avoid unauthorized cache/demo |
| Portfolio misuse | Medium / Medium | restrict to authorized assets, avoid vulnerable-target ranking |

## 17. Definition of Done / project exit criteria

**Minimum complete:** publicly demoable web app; exact property source match; >=2 real authorized source layers if required; deterministic ADA tests; one evidence-backed finding with uncertainty; agent plan and tool trace; owner action plan; disclaimer and documentation.

**Excellent:** real Matterport anchored tag with click/fly-to, genuinely georeferenced Vexcel parking overlays, human verified measurement, timestamp and provenance for every claim, live-provider graceful degradation.

**Never claim:** “automatically certifies ADA compliance”, “accurately measures every door from Matterport”, “proves ramp slopes from aerial elevation”, “cost after tax savings” without qualified accountant analysis, or “audits any address” without coverage.

## 18. Immediate next actions

**Human/sponsor lead:** obtain three key sets, terms, valid linked commercial model/property IDs, permissions for public demo, submission deadline. Record answers in `DATA_ACCESS_CHECKLIST.md`.

**Backend developer:** keep starter green, create standard typed finding schema and fixture-driven FastAPI job, add source adapters and deterministic tests.

**AI developer:** implement explicit Deep Agents subagents, safe tools, event logging and grounding gate; test with fixtures before private tools.

**Frontend developer:** make polished property→audit→findings flow; issue-click moves aerial highlight, Matterport only when real coordinate mapping works.

**Presenter:** validate exact claims, obtain screenshot permission, rehearse one reliable property walkthrough and prepare recorded fallback.

---

## Appendix A. Source links and verification status as of 14 Nov 2026

1. Matterport Property Intelligence (Enterprise requirement, dimensionalEstimates/floors/rooms): https://developers.matterport.com/api/property-intelligence/ — **documentation verified**, account entitlement not verified.
2. Matterport Model API (account credentials, GraphQL endpoint): https://developers.matterport.com/api/model/overview/ — **documentation verified**, account and model access not verified.
3. Matterport room dimension definitions: https://developers.matterport.com/api/property-intelligence/dimensions/ — **documentation verified**; does *not* prove door clear widths are exposed.
4. Vexcel MCP setup: https://vexceldata.com/platform/vexcel-mcp/mcp-get-started/ — **documentation verified**, key/coverage not verified.
5. Deep Agents API: https://reference.langchain.com/python/deepagents/graph/create_deep_agent — **documentation verified**; actual integration not written in starter.
6. Deep Agents MCP docs: https://github.com/langchain-ai/docs/blob/main/src/oss/deepagents/tools.mdx — **documentation verified**.
7. ADA standards: https://www.ada.gov/law-and-regs/design-standards/2010-stds/ — **official rule source**.
8. USGS image service: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer — **public service documented**, site-specific image resolution/capture date variable.
9. LA County Open Data: https://data.lacounty.gov/ — **public fallback**, needs actual dataset and permitted join.
10. Harris County Appraisal District: https://hcad.org/pdata/pdata-property-downloads.html — **public fallback**, need latest downloadable data confirmation.

## Appendix B. Starter files and commands

```
unstuck_starter/
├── README.md
├── app.py
├── index.html
├── rules.py
└── test_rules.py
```

```bash
unzip unstuck_starter.zip
cd unstuck_starter
python -m unittest -v test_rules.py
python app.py
# http://localhost:8000
```

**Final reminder:** The current starter demonstrates interface + rules, not automated provider integration or a real ADA inspection. The next development milestone is a **single verified cross-source property**, not additional UI polish or agent complexity.
