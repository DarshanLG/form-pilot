"""Collect job URLs from the public Greenhouse / Lever job-board APIs.

Takes `--per-company` jobs from each board slug and appends new ones to the URL file.
Greenhouse URLs are normalized to the hosted job-boards.greenhouse.io form, since
`absolute_url` often points at a company careers site that embeds the form in an iframe.

Usage:
    python crawler/collect_urls.py greenhouse figma discord gitlab
    python crawler/collect_urls.py lever palantir spotify --per-company 2
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path


def fetch(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "FormPilot-research/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def greenhouse(slug: str, n: int) -> list[str]:
    jobs = fetch(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs").get("jobs", [])
    return [f"https://job-boards.greenhouse.io/{slug}/jobs/{j['id']}" for j in jobs[:n]]


def lever(slug: str, n: int) -> list[str]:
    posts = fetch(f"https://api.lever.co/v0/postings/{slug}?mode=json&limit={n}")
    return [p["hostedUrl"] for p in posts[:n]] if isinstance(posts, list) else []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("platform", choices=["greenhouse", "lever"])
    ap.add_argument("slugs", nargs="+")
    ap.add_argument("--per-company", type=int, default=1)
    ap.add_argument("--out", help="default: data/urls/<platform>.txt")
    args = ap.parse_args()

    out = Path(args.out or f"data/urls/{args.platform}.txt")
    existing = out.read_text().splitlines() if out.exists() else []
    seen = set(existing)
    get = greenhouse if args.platform == "greenhouse" else lever
    added = []
    for slug in args.slugs:
        try:
            urls = get(slug, args.per_company)
        except Exception as e:
            print(f"  FAIL {slug}: {e}")
            urls = []
        if not urls:
            print(f"  no jobs: {slug}")
        added += [u for u in urls if u not in seen and not seen.add(u)]
        time.sleep(1)
    out.write_text("\n".join(existing + added) + "\n")
    print(f"+{len(added)} -> {out}")


if __name__ == "__main__":
    main()
