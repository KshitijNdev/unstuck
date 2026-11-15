# Unstuck

Accessibility screening for commercial buildings. Unstuck pulls the property record (CoStar), the view from above (Vexcel) and the 3D scan (Matterport) for one building, runs tested numeric checks from the 2010 ADA Standards, and shows the evidence behind each result so an owner knows what to check first.

> **Screening, not certification.** Unstuck is not a certified ADA inspection or a legal compliance determination, and does not replace a California CASp, a Texas RAS, a qualified accessibility consultant or field measurements. It never calls an unmeasured guess a violation.

Built at HackPrinceton Fall 2026 (CoStar "Inside and Out" track).

## Who it is for

A commercial landlord or property manager who wants to know where accessibility barriers might be before a renovation, complaint or paid inspection. It is for screening buildings you own or are authorized to audit, not for finding other people's.

## What it does today

1. **Pick a property.** Search 541 non-residential buildings in Houston and Los Angeles that have both a CoStar record and a Matterport scan.
2. **Gather evidence.** A LangChain Deep Agent plans the audit and delegates to three subagents. The property investigator looks up the CoStar record (use type, year built, parking counts). The exterior inspector fetches a Vexcel orthophoto of the site. The interior inspector compares the linked Matterport scans, loads one and measures its doorway openings from the floor plan. The orchestrator then checks that the scan sits where CoStar says the building is.
3. **Screen.** A pure-Python rule engine compares structured measurements against the standards. No language model does any arithmetic.
4. **Ask a person for what it cannot know.** You mark accessible stalls directly on the aerial image, or enter a door width measured on site or in the 3D tour. The checks re-run immediately.
5. **Report.** A printable action plan groups results into act on, measure next, and meets threshold, with a JSON export and a full audit trail.

Every result is labelled **measured**, **suspected** or **review needed**, with its source, method and reviewer.

### Checks implemented

| Check | Rule | Standard |
|---|---|---|
| Accessible parking count | Table 208.2 by lot size; hospital outpatient 10%, rehab 20% | §208.2 |
| Van-accessible spaces | 1 per 6 accessible spaces or fraction | §208.2.4 |
| Door clear opening | 32 in; 36 in when the opening is deeper than 24 in | §404.2.3 |
| Doorway opening from a scan | Floor-plan opening under 31 in: suspected below 32 in. Wider: needs measurement (never a pass) | §404.2.3 |
| Accessible route width | 36 in; 32 in allowed for at most 24 in (engine only, not yet in the UI) | §403.5.1 |

Missing or unverified inputs return "needs field measurement". Nothing is defaulted, and a non-field measurement within half an inch of a threshold is sent back for a tape measure.

## What is real and what is not

| Piece | State |
|---|---|
| CoStar property record and Matterport crosswalk | Real, from the hackathon data extract |
| Vexcel orthophoto | Real, fetched live through the API (key stays server-side) |
| Matterport model identity, rooms, tour embed | Real, fetched live |
| Accessible stall counts | Entered by a person marking the image. Not detected automatically |
| Doorway openings | Real, read live from the Matterport floor plan (`floors.edges.openings`, type `doorway`) when the scan has one: 32 of 80 sampled scans did. An opening is the frame gap, so it can flag a narrow doorway but never pass one |
| Door clear width | Entered by a person (tape on site, or the tour's measurement tool). Replaces the scan opening for that door |
| Total parking | CoStar's property-wide surface count, flagged because §208.2 applies per lot |
| Agent | **LangChain Deep Agent** (`deepagents` on LangGraph) with Claude (`claude-opus-5-5`) as the model through `langchain-anthropic`, when `ANTHROPIC_API_KEY` is set. An orchestrator writes the plan and delegates with the `task` tool to three subagents: property investigator, exterior inspector and interior inspector. The interior inspector compares linked scans, prefers one with a floor plan and public areas, and measures its doorways. The agents cannot create findings, and the summary is rejected if it uses legal words like "compliant" or "violation". Without a key, or if the Deep Agent fails mid-audit, a fixed scripted pipeline (no AI) runs the same steps |
| AI token usage | Recorded per audit (requests, input, cached, output tokens, list-price estimate), shown on the audit page and totalled at `GET /api/usage`. A typical audit is about 8 requests, 50k input tokens (mostly cached) and 1.5k output tokens, about $0.09 on `claude-opus-5-5` |
| Demo property | A clearly labelled synthetic fixture, for trying the flow without sponsor data |
| Cost estimates, tax savings | Not shown. No sourced assumptions exist |
| Vexcel capture date | Vexcel's own estimate (`metadata.ortho-date-estimate` from `property/extract`), with the layer and collection. The image is then fetched from that same layer so the date applies to it. Shown as unknown when Vexcel has no parcel at the site |
| "Built before the ADA" | A labelled context note when CoStar's year built is before 1992. Background only: it never creates a finding or changes a result |

## Run it

Requires Python 3.12 (via [uv](https://docs.astral.sh/uv/)) and Node 20+.

```bash
cd services/api && uv sync && uv run pytest -q
```

```bash
cd services/api && uv run uvicorn app.main:app --port 8000
```

```bash
cd apps/web && npm install && npm run dev
```

Open http://localhost:3000. Without any keys the synthetic demo and public USGS imagery still work, and sponsor sources show as unavailable.

### Sponsor data

Copy `.env.example` to `services/api/.env` and fill in the values from `/costar-keys` in the track Discord:

- `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`
- `VEXCEL_API_KEY`
- `COSTAR_KIT_DIR`: path to the unzipped CoStar kit (the folder containing `data/commercial-property.jsonl`)
- `ANTHROPIC_API_KEY` (optional): turns on the Deep Agent. `UNSTUCK_MODEL` overrides the model; `UNSTUCK_AGENT=off` forces the scripted pipeline

`.env` and `data/` are gitignored. Sponsor data is for hackathon use only and is never committed.

## How it is built

```
apps/web        Next.js 16 + Tailwind: property picker, live audit view, evidence, checks, report
services/api    FastAPI
  app/rules       ada2010.py: deterministic checks, each with a citation
  app/providers   costar, vexcel, matterport, usgs (public fallback), fixture (synthetic)
  app/agents      orchestrator.py: LangChain Deep Agent (deepagents) with three subagents over the same steps
  app/pipeline    runner.py (shared steps, scripted fallback, event log), evaluate.py (measurements -> findings)
  app/routes      audits, events (SSE), measurements, image marks, review, export
  tests           107 tests: every threshold boundary, missing-data behaviour, API contracts, the Deep Agent graph with a scripted model, doorway screening, token accounting
docs/HANDOFF.md Full product and engineering brief
```

The agent and the scripted pipeline call the same step functions and emit the same events (`PLANNED`, `FETCH_STARTED`, `RULE_EVALUATED`, `REVIEW_REQUESTED`, `AGENT_NOTE`, ...), so the UI doesn't depend on which one ran. Tests never call the real model.

## Accessibility of Unstuck itself

An accessibility tool should pass its own audit. Checked on 15 Nov 2026 against the landing page, a real audit (The Granada Buildings, CoStar 120125) and its action plan:

- **axe-core 4.10** (WCAG 2.0, 2.1 and 2.2 A/AA plus best practices): no violations. Checked on every stage layer (aerial, 3D interior, record), every inspector tab and the integrations panel, at 1440, 390 and 320 px wide.
- **Lighthouse 12.2**: accessibility 100 and best practices 100 on all three pages, on both desktop and mobile.
- **Keyboard only.** A tested path runs through the whole inspection:
  - The view and inspector tabs follow the ARIA tab pattern (arrow keys, Home and End).
  - Left and right arrows step through checks.
  - A zoomed image pans with the arrow keys.
  - Stall marks can be placed without a mouse: focus the image, move the crosshair with the arrows and press Enter.
  - Focus rings stay visible on the dark stage.
- **Reflow.** Below 900 px the inspector stacks under the image, with no horizontal scrolling at 320 px.

Fixed along the way:

- the check arrows were 7 px wide
- headings skipped levels
- some landmarks were nested
- the log and record panels scrolled but couldn't be reached by keyboard
- hidden landing pins stayed in the tab order
- the inspector covered the whole stage on a phone

Automated tools catch only part of WCAG, and no screen-reader user has tested the app yet. So this is a screen, not a conformance claim, the same standard Unstuck applies to buildings.

## Limits you should know

- Whether a rule applies to a given building (construction date, alterations, exceptions, readily-achievable barrier removal) is not evaluated. California Title 24 and Texas TAS are not covered.
- Aerial imagery supports counting and locating stalls. It does not support stall widths, aisle widths or slopes.
- Many scans in the dataset are individual suites, some classified by Matterport as living space. Pick the scan that shows the public entrance or common areas.
- Many scans have no floor plan, so no doorway can be measured from them. Doorways in a scan are not matched to the main entrance; the entrance check still needs a person.
- A passing check covers one dimension, not overall accessibility.

## Next

- Vision-proposed stall candidates on the Vexcel image, confirmed by a person
- Vexcel oblique views and object detection
- Owner portfolio view: rank your own buildings by what most needs measuring

## Sources

- 2010 ADA Standards: https://www.ada.gov/law-and-regs/design-standards/2010-stds/
- Matterport Model API: https://matterport.github.io/developer-docs/api/
- USGS NAIP imagery: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer
