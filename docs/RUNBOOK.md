# Unstuck dev runbook (for an operator agent)

You run commands for this project: start and stop servers, run tests, read logs, smoke-test endpoints, report results. Unless you're told to, don't change application code, don't install new dependencies, and don't commit.

Repo root: `/home/knaramdev/hackprinceton/unstuck`. Run every command below from there.

## Hard rules (secrets)

1. **Never print, cat, echo, grep or paste the contents of `services/api/.env`.** It holds live API keys. To check that a variable is set, run `grep -c '^VEXCEL_API_KEY=.' services/api/.env` (it prints 1 or 0, never the value).
2. **Never `git add`, `git commit` or `git push`** unless the user tells you to in that message. Never `git add -f` anything. A pre-commit hook blocks `.env` files and key-like strings. If it fires, stop and tell the user, and don't bypass it with `--no-verify`.
3. Never copy files out of `../costar-hackathon-kit/` (licensed sponsor data, hackathon use only) and never send the data or keys to any outside service.
4. If a log line contains a key or token, summarize it and leave the value out.

## Tooling

`uv` lives in `~/.local/bin` and Node 22 in `~/.local/node22/bin`. `scripts/dev.sh` adds both to `PATH`. For direct commands, prefix with:

```bash
export PATH="$HOME/.local/bin:$HOME/.local/node22/bin:$PATH"
```

## Start, stop, check

```bash
scripts/dev.sh restart   # kill anything on ports 8000/3000, start API + web, wait, print status
scripts/dev.sh status    # api: 200 / web: 200 means both are up
scripts/dev.sh stop
scripts/dev.sh logs      # last 40 lines of each log
```

- API: http://127.0.0.1:8000 (FastAPI with auto-reload on `services/api/app`). Log: `.logs/api.log`
- Web: http://localhost:3000 (Next.js dev). Log: `.logs/web.log`. `dev.sh` starts it with `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`, so the browser always calls this API. If you start the web by hand, set the same variable.
- `.logs/` is gitignored.

The API reads `services/api/.env` at startup. After the `.env` changes, run `scripts/dev.sh restart`.

## Tests

```bash
cd services/api && uv run pytest -q          # ~87 tests, never call real APIs or the model
cd apps/web && npx tsc --noEmit && npm run lint
```

Report the pass/fail counts and the first failure's traceback. Don't "fix" a failing test by editing it.

## Smoke checks (live data)

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/api/sources/status     # each provider's state
curl -s "http://127.0.0.1:8000/api/properties/search?q=houston&limit=3"
curl -s http://127.0.0.1:8000/api/usage              # Claude token usage and cost so far
```

Expected `sources/status` states: CoStar `connected` (569 properties, 541 with a scan), Vexcel `connected`, Matterport `limited` (normal: no door openings), USGS `limited` (fallback). `engine` should be `claude_agent`. `scripted` means `ANTHROPIC_API_KEY` is missing or `UNSTUCK_AGENT=off`.

Run one real audit end to end (calls Vexcel, Matterport and Claude; about $0.09 each, so don't loop it):

```bash
curl -s -X POST http://127.0.0.1:8000/api/audits -H 'content-type: application/json' \
  -d '{"costar_property_id": 1517580, "ownership_authorized": true}'
# -> {"audit_id": "audit_xxx", ...}
curl -s http://127.0.0.1:8000/api/audits/audit_xxx            # poll until status is done/needs review
curl -s http://127.0.0.1:8000/api/audits/audit_xxx/findings
```

For a free run without sponsor APIs, use the synthetic demo. Get its id from `GET /api/properties/demo` and post `{"property_id": "<id>", "allow_synthetic_fixture": true}`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `status` shows `000` for the api | `tail -50 .logs/api.log`. Usually an import error or port in use. Run `scripts/dev.sh restart` |
| `status` shows `000` for the web | `tail -50 .logs/web.log`. If modules are missing: `cd apps/web && npm install`, then restart |
| `uv: command not found` | Run the PATH export above |
| CoStar `unavailable` | Check that `COSTAR_KIT_DIR` is set (`grep -c '^COSTAR_KIT_DIR=.' services/api/.env`) and that `/home/knaramdev/hackprinceton/costar-hackathon-kit/data/commercial-property.jsonl` exists. Don't print the value of any other key |
| Vexcel/Matterport errors (401/403) | Report it to the user. Keys may have expired. Don't try other keys |
| Stale DB state | `services/api/unstuck.sqlite` is a local, gitignored DB. Delete it only if the user asks |

## Reporting back

Keep it short: what you ran, the result (status codes, test counts), and the relevant log excerpt with secrets left out. If something needs a code change, describe it and don't make it.
