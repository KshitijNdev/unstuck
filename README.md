# Unstuck

Accessibility screening for commercial buildings. Unstuck pulls the property record (CoStar), the view from above (Vexcel) and the 3D scan (Matterport) for one building, runs tested numeric checks from the 2010 ADA Standards, and shows the evidence behind each result so an owner knows what to check first.

> **Screening, not certification.** Unstuck is not a certified ADA inspection or a legal compliance determination, and does not replace a California CASp, a Texas RAS, a qualified accessibility consultant or field measurements. It never calls an unmeasured guess a violation.

Built at HackPrinceton Fall 2026 (CoStar "Inside and Out" track).

## Who it is for

A commercial landlord or property manager who wants to know where accessibility barriers might be before a renovation, complaint or paid inspection. It is for screening buildings you own or are authorized to audit, not for finding other people's.

## What it does today

1. **Pick a property.** Search 541 non-residential buildings in Houston and Los Angeles that have both a CoStar record and a Matterport scan.
2. **Gather evidence.** A pipeline looks up the CoStar record (use type, year built, parking counts), fetches a Vexcel orthophoto of the site, loads the linked Matterport scan, and checks that the scan sits where CoStar says the building is.
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
| Accessible route width | 36 in; 32 in allowed for at most 24 in (engine only, not yet in the UI) | §403.5.1 |

Missing or unverified inputs return "needs field measurement". Nothing is defaulted, and a non-field measurement within half an inch of a threshold is sent back for a tape measure.

## What is real and what is not

| Piece | State |
|---|---|
| CoStar property record and Matterport crosswalk | Real, from the hackathon data extract |
| Vexcel orthophoto | Real, fetched live through the API (key stays server-side) |
| Matterport model identity, rooms, tour embed | Real, fetched live |
| Accessible stall counts | Entered by a person marking the image. Not detected automatically |
| Door clear width | Entered by a person. Matterport's wall graph exposes walls only, not door openings |
| Total parking | CoStar's property-wide surface count, flagged because §208.2 applies per lot |
| Agent | **A fixed scripted pipeline.** It emits a plan and tool-call log, but no LLM plans or decides anything yet |
| Demo property | A clearly labelled synthetic fixture, for trying the flow without sponsor data |
| Cost estimates, tax savings | Not shown. No sourced assumptions exist |
| Vexcel capture date | Not retrieved yet; shown as unknown |

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

`.env` and `data/` are gitignored. Sponsor data is for hackathon use only and is never committed.

## How it is built

```
apps/web        Next.js 16 + Tailwind: property picker, live audit view, evidence, checks, report
services/api    FastAPI
  app/rules       ada2010.py: deterministic checks, each with a citation
  app/providers   costar, vexcel, matterport, usgs (public fallback), fixture (synthetic)
  app/pipeline    runner.py (scripted steps + event log), evaluate.py (measurements -> findings)
  app/routes      audits, events (SSE), measurements, image marks, review, export
  tests           80 tests: every threshold boundary, missing-data behaviour, API contracts
docs/HANDOFF.md Full product and engineering brief
```

The pipeline emits the event types an agent would (`PLANNED`, `FETCH_STARTED`, `RULE_EVALUATED`, `REVIEW_REQUESTED`, ...) so a `deepagents` orchestrator can replace the script behind the same contract.

## Limits you should know

- Whether a rule applies to a given building (construction date, alterations, exceptions, readily-achievable barrier removal) is not evaluated. California Title 24 and Texas TAS are not covered.
- Aerial imagery supports counting and locating stalls. It does not support stall widths, aisle widths or slopes.
- Many scans in the dataset are individual suites, some classified by Matterport as living space. Pick the scan that shows the public entrance or common areas.
- A passing check covers one dimension, not overall accessibility.

## Next

- `deepagents` orchestrator with property, exterior, interior and report subagents (needs a model key)
- Vision-proposed stall candidates on the Vexcel image, confirmed by a person
- Vexcel capture dates, oblique views and object detection
- Owner portfolio view: rank your own buildings by what most needs measuring

## Sources

- 2010 ADA Standards: https://www.ada.gov/law-and-regs/design-standards/2010-stds/
- Matterport Model API: https://matterport.github.io/developer-docs/api/
- USGS NAIP imagery: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer
