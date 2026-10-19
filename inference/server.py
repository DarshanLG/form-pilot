"""FormPilot model server: screenshot + profile + history -> next action.

Run (localhost only; the extension calls it):
    uvicorn inference.server:app --host 127.0.0.1 --port 8000

Env: FORMPILOT_MODEL (default SmolVLM-256M-Instruct), FORMPILOT_ADAPTER (LoRA dir), FORMPILOT_COT=1,
FORMPILOT_DEVICE (cuda/cpu), FORMPILOT_ORIGINS (CORS origin regex).

Output is validated against the action schema; invalid output is retried with sampling, then replaced
by a `skip` of the next mark with `fallback: true` so the client can hand that field to the user.
The server never decides to submit: the extension owns the confirm-before-submit gate.
"""

from __future__ import annotations

import base64
import io
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.eval import parse

ACTIONS = ("type", "select", "click", "upload", "skip", "done")
FILES = ("resume", "cover_letter")
ATTEMPTS = 3  # greedy, then two sampled retries
MAX_IMAGE_B64 = 12_000_000

MODEL = os.environ.get("FORMPILOT_MODEL", "HuggingFaceTB/SmolVLM-256M-Instruct")
ADAPTER = os.environ.get("FORMPILOT_ADAPTER") or None
COT = os.environ.get("FORMPILOT_COT", "0") == "1"
DEVICE = os.environ.get("FORMPILOT_DEVICE") or None
ORIGINS = os.environ.get("FORMPILOT_ORIGINS", r"chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?")

state: dict = {}
lock = threading.Lock()  # one model, one GPU: serialize generation


@asynccontextmanager
async def lifespan(_: FastAPI):
    if "predictor" not in state:  # tests inject a fake
        from ml.predict import Predictor

        state["predictor"] = Predictor(MODEL, ADAPTER, device=DEVICE)
    yield
    state.clear()


app = FastAPI(title="FormPilot inference", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origin_regex=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"]
)


class ActRequest(BaseModel):
    screenshot: str = Field(description="base64 PNG/JPEG of the viewport with numbered marks drawn")
    marks: list[int] = Field(default_factory=list, description="mark numbers visible on screen")
    profile: dict
    history: list[dict] = Field(default_factory=list)


class ActResponse(BaseModel):
    action: str
    mark: int | None = None
    value: str | None = None
    thought: str | None = None
    fallback: bool = False
    attempts: int
    latency_ms: int
    raw: list[str]


def validate(obj: dict | None, marks: list[int]) -> str | None:
    """Why `obj` is not a usable action; None if it is."""
    if obj is None:
        return "no JSON object"
    action = obj.get("action")
    if action not in ACTIONS:
        return f"unknown action {action!r}"
    if action == "done":
        return None
    mark = obj.get("mark")
    if not isinstance(mark, int) or isinstance(mark, bool):
        return f"mark {mark!r} is not an integer"
    if marks and mark not in marks:
        return f"mark {mark} is not on screen"
    value = obj.get("value")
    if action in ("type", "select") and not (isinstance(value, str) and value.strip()):
        return f"{action} needs a value"
    if action == "upload" and value not in FILES:
        return f"upload value must be one of {FILES}"
    return None


def next_mark(history: list[dict], marks: list[int]) -> int | None:
    done = {h.get("mark") for h in history}
    left = sorted(m for m in marks if m not in done)
    if left:
        return left[0]
    return max((h["mark"] for h in history if isinstance(h.get("mark"), int)), default=0) + 1


def decode_image(b64: str):
    from PIL import Image

    if len(b64) > MAX_IMAGE_B64:
        raise HTTPException(413, "screenshot too large")
    try:
        data = base64.b64decode(b64.split(",", 1)[-1], validate=True)  # tolerate a data: URL prefix
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as e:  # any decode failure is the client's input
        raise HTTPException(422, f"screenshot is not a valid base64 image: {e}") from e


def act_sync(req: ActRequest) -> ActResponse:
    t0 = time.perf_counter()
    image = decode_image(req.screenshot)
    predictor, raw = state["predictor"], []
    for attempt in range(1, ATTEMPTS + 1):
        with lock:
            text = predictor.generate(image, req.profile, req.history, COT, prefill=True, sample=attempt > 1)
        raw.append(text)
        obj = parse(text)
        if validate(obj, req.marks) is None:
            ms = int((time.perf_counter() - t0) * 1000)
            value = obj.get("value") if obj["action"] in ("type", "select", "upload") else None
            mark = obj.get("mark") if obj["action"] != "done" else None
            return ActResponse(
                action=obj["action"], mark=mark, value=value, thought=obj.get("thought"),
                attempts=attempt, latency_ms=ms, raw=raw,
            )  # fmt: skip
    ms = int((time.perf_counter() - t0) * 1000)
    return ActResponse(
        action="skip", mark=next_mark(req.history, req.marks), fallback=True,
        attempts=ATTEMPTS, latency_ms=ms, raw=raw,
    )  # fmt: skip


@app.post("/act", response_model=ActResponse)
async def act(req: ActRequest) -> ActResponse:
    return await run_in_threadpool(act_sync, req)  # one GPU: generate() blocks; keep the loop free


@app.get("/health")
def health() -> dict:
    p = state.get("predictor")
    return {"ok": p is not None, "model": MODEL, "adapter": ADAPTER, "cot": COT, "device": p and p.device}
