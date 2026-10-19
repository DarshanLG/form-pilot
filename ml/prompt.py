"""Prompt and target rendering shared by dataset build, training, eval and inference.

Keep this the single source of truth: a change here changes what the model sees everywhere.
"""

from __future__ import annotations

import json
from functools import lru_cache

SYSTEM = (
    "You fill online job applications. The screenshot shows a form with numbered marks over its fields. "
    "Given the applicant's profile and the actions taken so far, output the next action as one JSON object. "
    "Actions: type, select, click, upload (value is resume or cover_letter), skip, done. "
    "Skip a field when the profile does not answer it or the applicant must decide it themselves. "
    "Never submit the form; output done when every mark is handled."
)
FORMAT = {
    True: 'Format: {"thought": "<one sentence>", "action": "...", "mark": <number>, "value": "..."}',
    False: 'Format: {"action": "...", "mark": <number>, "value": "..."}',
}

HISTORY_MAX = 10  # most recent actions shown to the model


def render_user(profile: dict, history: list[dict]) -> str:
    recent = history[-HISTORY_MAX:]
    hist = "\n".join(json.dumps(h, ensure_ascii=False) for h in recent) or "(none)"
    return f"Profile:\n{json.dumps(profile, ensure_ascii=False)}\n\nPrevious actions:\n{hist}\n\nNext action:"


def render_target(target: dict, thought: str | None) -> str:
    """`thought` None -> no_cot format. The thought goes first so the model reasons before acting."""
    out = {"thought": thought} if thought is not None else {}
    out.update({k: v for k, v in target.items() if v is not None})
    return json.dumps(out, ensure_ascii=False)


def messages(profile: dict, history: list[dict], cot: bool) -> list[dict]:
    """Chat messages for one step; the image goes in the processor call alongside these."""
    text = f"{SYSTEM}\n{FORMAT[cot]}\n\n{render_user(profile, history)}"
    return [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": text}]}]


@lru_cache(maxsize=2)  # examples come in form order; full pages are big
def _page(path: str):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None  # full-page screenshots run past PIL's bomb check
    return Image.open(path).convert("RGB")


def load_image(ex: dict):
    """The example's viewport-sized crop of its marked full-page screenshot."""
    x, y, w, h = ex["crop"]
    return _page(ex["image"]).crop((x, y, x + w, y + h))
