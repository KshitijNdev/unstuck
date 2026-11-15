"""Unstuck API. Screening and evidence management, not certification."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def _load_env() -> None:
    """Tiny .env loader (services/api/.env). Existing environment variables win."""
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if v.strip():
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

from .routes import audits, portfolio, vision  # noqa: E402  (after env is loaded)

app = FastAPI(title="Unstuck API", version="0.1.0",
              description="Accessibility screening. Not a certified ADA inspection or legal determination.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("WEB_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["GET", "POST"], allow_headers=["Content-Type"],
)
app.include_router(audits.router)
app.include_router(vision.router)
app.include_router(portfolio.router)


@app.get("/health")
def health():
    return {"status": "ok"}
