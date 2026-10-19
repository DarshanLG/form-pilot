"""Evaluate a model on a dataset split. The only source of reported metrics (logged to ml/RESULTS.md).

Usage:
    python ml/eval.py --model HuggingFaceTB/SmolVLM-256M-Instruct --name zs-256m [--cot] [--log]
    python ml/eval.py --model always-skip --name always-skip           # no-model reference baseline
    python ml/eval.py --preds data/runs/zs-256m_test.jsonl            # rescore saved predictions

Predictions are cached in data/runs/<name>_<split>.jsonl, so an interrupted run resumes.
Action accuracy: action type, mark and value all correct (value: normalized exact match; ignored for
click/skip; mark ignored for done). Typed free text (textarea) is reported separately and left out of
the overall number: exact match is the wrong test for it.
--log appends the result to ml/RESULTS.md and is only allowed for a full split.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

RESULTS = Path(__file__).with_name("RESULTS.md")
VALUE_ACTIONS = ("type", "select", "upload")


def parse(text: str) -> dict | None:
    """First JSON object in the model's output; None if there is none."""
    start = text.find("{")
    if start < 0:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def norm(v) -> str:
    return re.sub(r"\s+", " ", str(v).casefold()).strip(" .,/")


def score(pred: dict | None, target: dict) -> dict[str, bool]:
    ok_action = pred is not None and pred.get("action") == target["action"]
    try:
        ok_mark = target["action"] == "done" or int(pred.get("mark")) == target["mark"]
    except (TypeError, ValueError, AttributeError):
        ok_mark = False
    ok_value = target["action"] not in VALUE_ACTIONS or (
        pred is not None and norm(pred.get("value", "")) == norm(target["value"])
    )
    return {"valid": pred is not None, "action": ok_action, "correct": ok_action and ok_mark and ok_value}


ALWAYS_SKIP = "always-skip"


def always_skip(ex: dict, cot: bool, prefill: bool = False) -> str:
    """Reference baseline, no model: skip the mark after the last one handled."""
    marks = [h["mark"] for h in ex["history"] if "mark" in h]
    return json.dumps({"action": "skip", "mark": max(marks, default=0) + 1})


def is_free_text(ex: dict) -> bool:
    return ex["target"]["action"] == "type" and ex["field_type"] == "textarea"


def summarize(examples: list[dict], preds: dict[str, str]) -> dict:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for ex in examples:
        s = score(parse(preds[ex["id"]]), ex["target"])
        if is_free_text(ex):
            buckets["free_text"].append(s)
            continue
        buckets["overall"].append(s)
        buckets["ambiguous" if ex["ambiguous"] else "unambiguous"].append(s)
        buckets[ex["platform"]].append(s)
        buckets[f"action:{ex['target']['action']}"].append(s)
    out = {}
    for name, rows in buckets.items():
        n = len(rows)
        out[name] = {
            "n": n,
            "acc": sum(r["correct"] for r in rows) / n,
            "action_acc": sum(r["action"] for r in rows) / n,
            "valid": sum(r["valid"] for r in rows) / n,
        }
    return out


def git_rev() -> str:
    cmd = ["git", "describe", "--always", "--dirty", "--abbrev=7"]
    return subprocess.run(cmd, check=False, capture_output=True, text=True).stdout.strip()


def report(m: dict) -> str:
    order = ["overall", "unambiguous", "ambiguous", "greenhouse", "lever", "workday"]
    order += sorted(k for k in m if k.startswith("action:")) + ["free_text"]
    lines = ["| subset | n | action acc | action-type acc | valid JSON |", "|---|---:|---:|---:|---:|"]
    for k in order:
        if k in m:
            r = m[k]
            lines.append(f"| {k} | {r['n']} | {r['acc']:.1%} | {r['action_acc']:.1%} | {r['valid']:.1%} |")
    return "\n".join(lines)


def log(args, m: dict, n: int, secs_per_ex: float | None) -> None:
    if not RESULTS.exists():
        RESULTS.write_text(
            "# Results\n\nEvery number here comes from `ml/eval.py`. Newest last.\n", encoding="utf-8"
        )
    speed = f", {secs_per_ex:.2f} s/example" if secs_per_ex else ""
    head = (
        f"\n## {args.name} · {args.split} · {date.today().isoformat()} · commit `{git_rev()}`\n\n"
        f"Model `{args.model}`"
        + (f" + adapter `{args.adapter}`" if args.adapter else "")
        + f", format `{'with_cot' if args.cot else 'no_cot'}`, {'prefill, ' if args.prefill else ''}longest_edge {args.longest_edge}, n={n}{speed}.\n\n"
    )
    with RESULTS.open("a", encoding="utf-8") as fh:
        fh.write(head + report(m) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="HuggingFaceTB/SmolVLM-256M-Instruct")
    ap.add_argument("--adapter")
    ap.add_argument("--name", help="run name; predictions go to data/runs/<name>_<split>.jsonl")
    ap.add_argument("--preds", help="score this predictions file instead of running a model")
    ap.add_argument("--split", default="test", choices=["train", "val", "test"])
    ap.add_argument("--data", default="data/dataset")
    ap.add_argument("--cot", action="store_true", help="prompt for / expect the with_cot format")
    ap.add_argument("--longest-edge", type=int, default=1024)
    ap.add_argument("--prefill", action="store_true", help="start the answer with the first JSON key")
    ap.add_argument("--limit", type=int, help="first N examples only (smoke tests; cannot --log)")
    ap.add_argument("--log", action="store_true", help="append to ml/RESULTS.md")
    args = ap.parse_args()
    if args.log and args.limit:
        sys.exit("--log needs the full split; drop --limit")
    if not (args.name or args.preds):
        sys.exit("give --name (run a model) or --preds (rescore)")

    with open(Path(args.data) / f"{args.split}.jsonl", encoding="utf-8") as fh:
        examples = [json.loads(line) for line in fh]
    examples = examples[: args.limit] if args.limit else examples

    path = Path(args.preds or f"data/runs/{args.name}_{args.split}.jsonl")
    preds: dict[str, str] = {}
    if path.exists():
        with path.open(encoding="utf-8") as fh:
            preds = {r["id"]: r["output"] for r in map(json.loads, fh)}

    secs = None
    todo = [ex for ex in examples if ex["id"] not in preds]
    if todo and args.preds:
        sys.exit(f"{len(todo)} examples have no prediction in {path}")
    if todo:
        if args.model == ALWAYS_SKIP:
            predictor = always_skip
        else:
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from ml.predict import Predictor

            predictor = Predictor(args.model, args.adapter, args.longest_edge)
        path.parent.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        with path.open("a", encoding="utf-8") as fh:
            for i, ex in enumerate(todo, 1):
                preds[ex["id"]] = predictor(ex, args.cot, args.prefill)
                fh.write(json.dumps({"id": ex["id"], "output": preds[ex["id"]]}, ensure_ascii=False) + "\n")
                fh.flush()
                if i % 25 == 0 or i == len(todo):
                    rate = (time.time() - t0) / i
                    print(
                        f"{i}/{len(todo)}  {rate:.2f} s/ex  eta {rate * (len(todo) - i) / 60:.0f} min",
                        flush=True,
                    )
        secs = (time.time() - t0) / len(todo)

    m = summarize(examples, preds)
    print(report(m))
    if args.log:
        log(args, m, len(examples), secs)
        print(f"logged -> {RESULTS}")


if __name__ == "__main__":
    main()
