# Unstuck

An agent that screens commercial buildings for ADA accessibility problems before a complaint is filed.

Give it a Houston or LA address. It pulls CoStar data on the building, inspects the parking lot from above with Vexcel aerial imagery, and checks doorways and rooms in the Matterport 3D scan. It produces an ADA screening report with each problem pinned inside the 3D tour and the fixes ranked by cost.

> **Screening tool, not a certified inspection.** Unstuck does not replace a California Certified Access Specialist (CASp) or a Texas Registered Accessibility Specialist (RAS). Cost figures are rough estimates, not quotes.

> **Status:** hackathon project, early planning. Details in this README will change.

## Target user

A commercial landlord or property manager who wants to know their ADA exposure before someone files a complaint. Retail, restaurants and medical offices serve the public, so ADA Title III applies to them.

## Modes

1. **Single audit:** input an address, get a full report.
2. **Portfolio audit:** an owner audits their own buildings. The agent plans the work, picks targets from CoStar data, runs each audit and ranks the results.
   - Framing note: this must stay "owner audits own portfolio." A "find the most at-risk buildings in a zip code" framing can read as a target list for serial plaintiffs.

## Why this matters

- 8,667 ADA Title III lawsuits were filed in or moved to federal court in 2025, about three times the 2013 number. California had 3,252, Florida 1,823, New York 1,471 and Texas 177 (Seyfarth, via JD Supra / Mondaq).
- California's Unruh Act turns ADA violations into state-law claims with money damages: $4,000 per **occasion** for physical-access claims (not per violation).
- Only a CASp inspection gives an owner "qualified defendant" protections in California. Unstuck is a cheap screening step *before* paying for one.
- Texas uses its own standard (TAS) with RAS inspections. New buildings are already inspected, so older ones are the gap. Much smaller lawsuit market.

## Hackathon targets

| Prize | Criteria / requirements |
|---|---|
| CoStar (Business & Enterprise track) | 30% use of data, 30% agentic depth, 25% usefulness, 15% demo. Must use at least 2 of 3 data layers. Penalized for a chat wrapper over a property record. Wants the agent to plan and act and to use spatial/visual data. |
| Amazon | Creativity, usefulness, technical implementation, UX (25% each). Needs a working demo, clear use case and target user, basic documentation, and a pitch. |
| LangChain | Agent must be built with `deepagents`. |
| MLH add-ons (optional) | Gemini as the model, MongoDB Atlas for audit storage, GoDaddy domain. |

## Data sources

| Source | Used for | Access |
|---|---|---|
| **CoStar** | Year built (pre-ADA = higher risk), property type, tenants, parking count, building size, owner | Hackathon toolkit (API keys, SDKs, MCP, OpenAPI). Houston and LA only. Not public. |
| **Matterport** | Doorways, rooms, ceiling heights, openings | Model API (GraphQL): `https://api.matterport.com/api/models/graph`. Property Intelligence data in `dimensionalEstimates`, `floors`, `rooms`, and `Opening` objects. |
| **Vexcel** | Parking stall count and striping, elevation, entrance photos | MCP server: `https://api.vexcelgroup.com/v2/mcp` (API key). Overhead imagery about 5.5-7.5 cm/pixel. |

### Known data risks

- **Matterport openings/dimensions may be Enterprise-only** (Property Insights enrollment). Door width is unconfirmed. Fallbacks: `measurementPaths`, the Showcase SDK, or panorama images with a vision model estimating door widths and entrance steps (less exact).
- **Matterport scans may be mostly apartments**, which fall under the Fair Housing Act rather than ADA Title III. Only leasing offices and common areas count.
- **Vexcel elevation** is a rough red flag for "probably needs a ramp," not a measurement. ADA slopes (1:12, 1:48) are finer than it likely resolves.
- Need 3-5 commercial buildings that have both a Matterport scan and Vexcel coverage. No overlap means no project as scoped.

## ADA rules checked (2010 Standards)

Implemented as a **deterministic Python rule engine**. The LLM never does the comparisons.

| Check | Rule | Data |
|---|---|---|
| Door width | 32 in min clear; 36 in if doorway deeper than 24 in | Matterport |
| Route width | 36 in min, may narrow to 32 in for at most 24 in | Matterport |
| Walking slope | Running slope <= 1:20, cross slope <= 1:48; steeper than 1:20 is a ramp | Vexcel elevation (rough) |
| Ramps | 1:12 max; handrails both sides when rise > 6 in | Vexcel oblique + Matterport |
| Accessible space count | Table 208.2, based on lot size | CoStar parking count + Vexcel count |
| Van spaces | At least 1 per 6 accessible spaces | Vexcel |
| Space and aisle sizes | Accessible stalls 8 ft; van stalls 11 ft, or 8 ft with 8 ft aisle; access aisles 5 ft min | Vexcel |
| Parking location | On shortest accessible route to an accessible entrance | Vexcel + footprint |
| Special lots | Hospital outpatient 10%; rehab / physical therapy 20% | CoStar tenant type |

**TODO (verify against primary sources, not this table):** small-lot rows of Table 208.2 (ADA.gov), all rules against access-board.gov text. Measurements within scan error (e.g. 31.5 in vs 32 in) go in a **"borderline"** category with a confidence level.

Jurisdiction notes: for LA say "ADA screening" (California Title 24 is stricter in places). For Houston say "ADA (TAS may differ)."

## Fixes and cost

- Report sorts violations by the readily-achievable-barrier-removal priority order: access from sidewalks, parking and public transit first.
- Per-fix cost ranges (restriping, door, ramp) are LLM estimates, labeled as estimates.
- Net cost after tax incentives shown next to each fix:
  - Small-business credit up to $5,000, no credit for the first $250 spent (IRS Form 8826). **Eligibility size limits not yet verified.**
  - Section 190 deduction up to $15,000/year for barrier removal, any business size.

## Agent design

Built with [`deepagents`](https://docs.langchain.com/oss/python/deepagents/overview). MCP tools (Vexcel, CoStar) load via `langchain-mcp-adapters`.

```python
# pip install -qU deepagents langchain-mcp-adapters
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",   # or a Gemini model (MLH Gemini prize)
    tools=[...costar, ...vexcel_mcp, ...matterport, ada_rule_engine],
    subagents=[parking_inspector, interior_inspector, report_writer],
    system_prompt=AUDITOR_PROMPT,
)
```

| Component | Role |
|---|---|
| Orchestrator | Takes an address or portfolio query, writes a plan to its to-do list. The plan is shown in the UI (evidence for agentic depth). |
| `parking_inspector` | Vexcel imagery + elevation, vision model counts and classifies stalls, rule engine checks. |
| `interior_inspector` | Matterport rooms and openings, rule engine checks, records 3D coordinates of each violation. |
| `report_writer` | Prioritizes violations, estimates costs, subtracts tax incentives, writes report and owner summary. |
| `ada_rule_engine` | Plain, tested Python functions: measurements in, pass/fail + code section out. |

## Demo

- Embedded Matterport tour (Showcase SDK tags) with red pins at each violation. Clicking "Main entrance door: 29 in clear, needs 32 in (§404.2.3)" flies the tour to that doorway.
- Next to it, the Vexcel aerial with parking stalls outlined, accessible spaces green or red.
- Cache raw data for demo buildings locally so the demo cannot fail on an API timeout.

## Roadmap

- [ ] Get CoStar, Matterport, Vexcel keys; confirm Matterport exposes openings
- [ ] Pick 3-5 demo buildings with all required data
- [ ] Rule engine + tests
- [ ] Cache raw data for demo buildings
- [ ] deepagents orchestrator + subagents, one full audit working
- [ ] UI: tour with pins, aerial view, report
- [ ] Portfolio mode
- [ ] README final, 2-minute video, Devpost writeup (opt into CoStar, Amazon, LangChain)

## Human cross-check list

Do these before writing code. If item 1 fails ("scans are mostly apartments" or "no door widths"), rethink scope: the parking-lot half alone could still work.

**1. Data access (blocks everything)**
- [ ] CoStar, Matterport and Vexcel keys each return data for a test address
- [ ] What building types have Matterport scans? (apartments vs commercial)
- [ ] Any Matterport model returns `Opening` / `dimensionalEstimates`
- [ ] 3-5 commercial buildings with both Matterport and Vexcel coverage
- [ ] Vexcel parking imagery is current and stall lines are visible (look yourself)
- [ ] CoStar has parking count and year built for those buildings

**2. Measurement accuracy**
- [ ] Hand-measure a doorway with the Matterport tool and compare to API output
- [ ] Hand-count accessible stalls on one aerial and compare to the vision model

**3. Rules**
- [ ] Spot-check rule engine against access-board.gov and ADA.gov text
- [ ] Copy Table 208.2 small-lot rows from ADA.gov
- [ ] Title 24 caveat for LA, TAS caveat for Houston
- [ ] Verify small-business tax credit eligibility limits

**4. Framing**
- [ ] Portfolio mode framed as owner self-audit
- [ ] "Screening tool, not a certified inspection" disclaimer in the UI

**5. Prize logistics**
- [ ] deepagents is the real agent harness
- [ ] Opted into CoStar, Amazon, LangChain on Devpost
- [ ] README states use case and target user
- [ ] Know the submission deadline and demo format

**Questions for CoStar engineers on-site:** which buildings have all three data layers; do Matterport keys expose `Opening` and `dimensionalEstimates`; is Vexcel elevation in the toolkit; preferred format for showing a Matterport tour.

## References

- Matterport Model API (Property Intelligence) and GraphQL schema reference
- Vexcel MCP and API 2.0 docs
- LangChain Deep Agents docs
- US Access Board ADA Chapter 4; ADA.gov restriping/parking; 2010 ADA Standards §208
- Minnesota readily achievable barrier removal; ADA National Network FAQ
- California DGS CASp; TDLR Texas Accessibility Standards
- Seyfarth ADA Title III filings 2025

## License

TBD
