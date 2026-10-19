"""python -m pytest inference -q  (no model needed: the predictor is faked)."""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from inference import server


class Fake:
    device = "fake"

    def __init__(self, outputs: list[str]):
        self.outputs, self.calls = list(outputs), []

    def generate(self, image, profile, history, cot, prefill=False, sample=False):
        self.calls.append(sample)
        return self.outputs.pop(0)


def png() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), "white").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def post(outputs: list[str], **body):
    server.state.clear()
    server.state["predictor"] = fake = Fake(outputs)
    with TestClient(server.app) as client:
        r = client.post("/act", json={"screenshot": png(), "profile": {}, **body})
    return r, fake


def test_valid_first_try():
    r, fake = post(['{"action": "type", "mark": 2, "value": "Ada"}'], marks=[1, 2])
    assert r.status_code == 200
    assert (r.json()["action"], r.json()["mark"], r.json()["value"], r.json()["attempts"]) == (
        "type",
        2,
        "Ada",
        1,
    )
    assert fake.calls == [False]


def test_retry_then_valid():
    r, fake = post(['{"action": "apply"}', '{"action": "skip", "mark": 1}'], marks=[1])
    assert (r.json()["action"], r.json()["attempts"], r.json()["fallback"]) == ("skip", 2, False)
    assert fake.calls == [False, True]  # retry samples


def test_fallback_skips_next_unhandled_mark():
    r, _ = post(["nope", '{"action": "type", "mark": 9, "value": "x"}', "{}"], marks=[1, 2, 3],
                history=[{"action": "skip", "mark": 1}])  # fmt: skip
    assert (r.json()["action"], r.json()["mark"], r.json()["fallback"]) == ("skip", 2, True)


@pytest.mark.parametrize(
    "obj,ok",
    [
        ({"action": "done"}, True),
        ({"action": "upload", "mark": 1, "value": "resume"}, True),
        ({"action": "upload", "mark": 1, "value": "photo"}, False),
        ({"action": "select", "mark": 1, "value": ""}, False),
        ({"action": "click", "mark": "1"}, False),
        ({"action": "click", "mark": True}, False),
        ({"action": "submit", "mark": 1}, False),
    ],
)
def test_validate(obj, ok):
    assert (server.validate(obj, [1]) is None) == ok


def test_bad_image():
    server.state["predictor"] = Fake([])
    with TestClient(server.app) as client:
        r = client.post("/act", json={"screenshot": "not-base64!", "profile": {}})
    assert r.status_code == 422
