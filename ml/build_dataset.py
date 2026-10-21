"""Build the training dataset: one example per marked field, plus one `done` per form.

Usage:
    python ml/build_dataset.py --samples data/samples.jsonl --raw data/raw --out data/dataset

Each example pairs (marked screenshot crop, a synthetic profile, previous actions) with the next action.
Profiles are synthetic variants of data/profile.example.json so the model learns to read the profile
instead of memorising one person; the real data/profile.json is never used here.

The split is by company and frozen in ml/split.json: existing assignments are never changed, new
companies are hashed into a split. Never train on `test`.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
import re
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crawler.autolabel import ACKNOWLEDGE
from ml.prompt import render_target

SPLIT_FILE = Path(__file__).with_name("split.json")
SPLITS = (("train", 0.7), ("val", 0.1), ("test", 0.2))
N_PROFILES = 50
CROP_H = 900  # viewport height used by crawler/capture.py
OPTION_TYPES = ("radio", "checkbox")

PLACEHOLDER = re.compile(r"^(select|choose|please select|--)\b.*|^$")
DECLINE = re.compile(
    r"decline|prefer not|don.?t wish|do not wish|do not want|not to (say|answer|disclose)|wish to answer"
)
MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]
DEGREE_ALIAS = {"m.s.": "master", "m.sc.": "master", "b.s.": "bachelor", "b.a.": "bachelor", "ph.d.": "ph.d"}
# Matches a value *and* its options: only a careers-page answer may fall back to a careers-page option.
KEY_FALLBACK = {
    "answers.how_did_you_hear": r"^(?!.*third.party).*(careers?\s*(page|site)|company\s*web\s*site|\bwebsite\b)"
}

# --- synthetic profiles -----------------------------------------------------------------------

FIRST = [
    "Aisha",
    "Ben",
    "Carlos",
    "Dana",
    "Elena",
    "Farhan",
    "Grace",
    "Hiro",
    "Ines",
    "Jamal",
    "Kavya",
    "Liam",
    "Mei",
    "Noah",
    "Olu",
    "Priya",
    "Quinn",
    "Rosa",
    "Sam",
    "Tariq",
]
LAST = [
    "Okafor",
    "Nguyen",
    "Garcia",
    "Smith",
    "Patel",
    "Kim",
    "Rossi",
    "Haddad",
    "Novak",
    "Johnson",
    "Silva",
    "Chen",
    "Mensah",
    "Murphy",
    "Tanaka",
]
CITIES = [
    ("Austin", "TX", "United States", "78701"),
    ("Seattle", "WA", "United States", "98101"),
    ("New York", "NY", "United States", "10001"),
    ("Chicago", "IL", "United States", "60601"),
    ("Long Beach", "CA", "United States", "90840"),
    ("Toronto", "ON", "Canada", "M5V 2T6"),
    ("London", "", "United Kingdom", "EC1A 1BB"),
    ("Berlin", "", "Germany", "10115"),
]
SCHOOLS = [
    "University of Texas at Austin",
    "University of Washington",
    "Georgia Institute of Technology",
    "California State University, Long Beach",
    "University of Toronto",
    "Purdue University",
]
DEGREES = ["Bachelor's Degree", "Master's Degree", "M.S.", "B.S."]
FIELDS = ["Computer Science", "Electrical Engineering", "Mathematics", "Data Science"]
COMPANIES = ["Acme Analytics", "Northwind Labs", "Globex", "Initech", "Umbrella Health", "Stark Logistics"]
TITLES = ["Software Engineer", "Data Analyst", "Machine Learning Engineer", "Frontend Engineer"]
PRONOUNS = ["she/her", "he/him", "they/them", ""]
HEAR = ["LinkedIn", "Company careers page", "Indeed", "Glassdoor"]


def synth_profile(base: dict, i: int) -> dict:
    rng = random.Random(i)
    p = copy.deepcopy(base)
    first, last = rng.choice(FIRST), rng.choice(LAST)
    handle = f"{first}{last}".lower()
    city, state, country, zip_ = rng.choice(CITIES)
    p["name"] = {"first": first, "last": last, "preferred": first if rng.random() < 0.8 else first[:3]}
    p["pronouns"] = rng.choice(PRONOUNS)
    p["email"] = f"{first}.{last}@example.com".lower()
    p["phone"] = f"+1 555 {rng.randint(100, 999)} {rng.randint(1000, 9999)}"
    p["location"] = {"city": city, "state": state, "country": country, "zip": zip_}
    p["links"] = {
        "linkedin": f"https://linkedin.com/in/{handle}",
        "github": f"https://github.com/{handle}" if rng.random() < 0.8 else "",
        "portfolio": f"https://{handle}.dev" if rng.random() < 0.5 else "",
        "twitter": f"https://x.com/{handle}" if rng.random() < 0.2 else "",
    }
    p["education"] = [
        {
            "school": rng.choice(SCHOOLS),
            "degree": rng.choice(DEGREES),
            "field": rng.choice(FIELDS),
            "gpa": f"{rng.uniform(3.0, 4.0):.1f}",
            "end": f"{rng.randint(2024, 2027)}-{rng.randint(1, 12):02d}",
        }
    ]
    p["work"] = [
        {
            "company": rng.choice(COMPANIES),
            "title": rng.choice(TITLES),
            "start": "2022-01",
            "end": "2024-12",
            "summary": "",
        }
    ]
    us = country == "United States"
    p["work_authorization"] = {
        "authorized_us": us or rng.random() < 0.3,
        "needs_sponsorship": not us and rng.random() < 0.7,
    }
    p["preferences"] = {
        "start_date": f"2027-{rng.randint(1, 12):02d}",
        "relocate": rng.random() < 0.6,
        "salary_expectation": rng.choice(["", "", "$120,000"]),
        "notice_period": rng.choice(["Immediate", "2 weeks", ""]),
    }
    p["eeo"] = {k: "decline" for k in base["eeo"]}
    p["eeo"]["gender"] = rng.choice(["Male", "Female", "decline"])
    p["consent"] = {"marketing": rng.random() < 0.3}
    p["files"] = {"resume": "resume.pdf", "cover_letter": "cover_letter.pdf" if rng.random() < 0.7 else ""}
    p["answers"] = {
        "how_did_you_hear": rng.choice(HEAR),
        "previously_employed_at": [],
        "why_this_company": "",
    }
    return p


# --- value resolution -------------------------------------------------------------------------


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).lower()).strip()


def slug(company: str) -> str:
    return re.sub(r"[^a-z0-9]", "", company.rsplit("/", 1)[-1].lower())


def get_path(p: dict, key: str):
    if key == "name.full":
        return f"{p['name']['first']} {p['name']['last']}"
    cur = p
    for part in key.split("."):
        if isinstance(cur, list):
            cur = cur[int(part)] if int(part) < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        if cur is None:
            return None
    return cur


def profile_value(p: dict, key: str, company: str):
    """The profile's answer for `key` as a string (or list of strings); None if it has none."""
    v = get_path(p, key)
    if key == "answers.previously_employed_at":
        return "Yes" if slug(company) in {slug(c) for c in v or []} else "No"
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if v in (None, "", []):
        return None
    return v


def match_option(value, options: list[str], key: str = "") -> str | None:
    """Pick the option that expresses `value`; None if none does."""
    opts = [o for o in options if not PLACEHOLDER.match(norm(o))]
    for v in value if isinstance(value, list) else [value]:
        n = norm(v)
        if exact := [o for o in opts if norm(o) == n]:
            return exact[0]
        if n == "decline":
            return next((o for o in opts if DECLINE.search(norm(o))), None)
        if n in ("yes", "no"):
            return next((o for o in opts if re.match(rf"{n}\b", norm(o))), None)
        if m := re.fullmatch(r"(\d{4})-(\d{2})", n):
            want = {MONTHS[int(m[2]) - 1], m[1]}
            return next((o for o in opts if norm(o) in want), None)
        n = DEGREE_ALIAS.get(n, n)
        hits = [o for o in opts if re.search(rf"(?<!\w){re.escape(n)}(?!\w)", norm(o))]
        if hits:
            return min(hits, key=len)
        fb = KEY_FALLBACK.get(key)
        if fb and re.search(fb, n) and (hits := [o for o in opts if re.search(fb, norm(o))]):
            return min(hits, key=len)
    return None


# --- examples ---------------------------------------------------------------------------------


def question(row: dict) -> str:
    q = row["group"] if row["field_type"] in OPTION_TYPES and row["group"] else row["label"]
    q = re.sub(r"\s+", " ", re.sub(r"[*✱]", " ", q)).strip()
    if row["options"] and (cut := q.find(row["options"][0].strip())) > 0:
        q = q[:cut].strip()  # a <select>'s label text includes its options
    return q if len(q) <= 80 else q[:77] + "..."


def target_for(row: dict, p: dict) -> tuple[dict, str, bool]:
    """-> (target action, thought, resolved). `resolved` False = the silver label could not be turned
    into a confident action (kept as skip, counted in the card)."""
    m, key, q = row["mark"], row["profile_key"], question(row)
    skip = {"action": "skip", "mark": m, "value": None}
    if row["field_type"] == "file":
        if key == "files.cover_letter" or re.search(r"cover\s*letter", q.lower()):
            which = "cover_letter"
        elif re.search(r"resume|résumé|\bcv\b", q.lower()):
            which = "resume"
        else:  # writing sample, portfolio, transcript...: no matching document in the profile
            return skip, f'Mark {m} asks for "{q}"; the profile has no such file, so skip.', True
        if not p["files"].get(which):
            return (
                skip,
                f"Mark {m} asks for a {which.replace('_', ' ')}; the profile has none, so skip.",
                True,
            )
        return (
            {"action": "upload", "mark": m, "value": which},
            f'Mark {m} is a file input for "{q}"; upload the {which.replace("_", " ")}.',
            True,
        )
    if key is None:
        if re.search(ACKNOWLEDGE, q.lower()):
            return (
                skip,
                f'Mark {m} is an acknowledgement ("{q}"); the applicant must confirm it themselves, so skip.',
                True,
            )
        return skip, f'Mark {m} asks "{q}"; no profile field answers it, so leave it for the applicant.', True
    v = profile_value(p, key, row["company"])
    if v is None:
        return skip, f'Mark {m} asks "{q}"; profile.{key} is empty, so skip.', True
    shown = ", ".join(v) if isinstance(v, list) else v
    if row["field_type"] in OPTION_TYPES:
        opt = row["option"] or ""
        if match_option(v, [opt], key):
            return (
                {"action": "click", "mark": m, "value": None},
                f'Mark {m} is the "{opt}" option of "{q}"; profile.{key} is "{shown}", so click it.',
                True,
            )
        return (
            skip,
            f'Mark {m} is the "{opt}" option of "{q}"; profile.{key} is "{shown}", so not this one.',
            True,
        )
    if row["action"] == "select" and row["options"]:
        opt = match_option(v, row["options"], key)
        if opt is None:
            return (
                skip,
                f'Mark {m} asks "{q}"; profile.{key} is "{shown}" but no option matches, so skip.',
                False,
            )
        return (
            {"action": "select", "mark": m, "value": opt},
            f'Mark {m} asks "{q}"; profile.{key} is "{shown}", so select "{opt}".',
            True,
        )
    action = "select" if row["action"] == "select" else "type"
    return (
        {"action": action, "mark": m, "value": shown},
        f'Mark {m} asks "{q}"; profile.{key} is "{shown}", so {action} it.',
        True,
    )


def png_height(path: Path) -> int:
    with open(path, "rb") as f:
        return struct.unpack(">II", f.read(24)[16:24])[1]


def crop_for(bbox: list[float], img_h: int, width: int) -> list[int]:
    """A viewport-sized window around the mark, like the page the extension would see."""
    cy = bbox[1] + bbox[3] / 2
    y0 = int(max(0, min(cy - CROP_H / 2, img_h - CROP_H)))
    return [0, y0, width, min(CROP_H, img_h)]


def load_split(platforms: dict[str, str]) -> dict[str, str]:
    """`platforms`: company -> platform."""
    split = json.loads(SPLIT_FILE.read_text()) if SPLIT_FILE.exists() else {}
    new = sorted(set(platforms) - set(split))
    if not split:  # first creation: exact proportions within each platform
        for plat in sorted(set(platforms.values())):
            cs = [c for c in new if platforms[c] == plat]
            random.Random(0).shuffle(cs)
            a, b = round(len(cs) * SPLITS[0][1]), round(len(cs) * (SPLITS[0][1] + SPLITS[1][1]))
            split.update({c: "train" if i < a else "val" if i < b else "test" for i, c in enumerate(cs)})
    else:  # frozen: only place unseen companies
        for c in new:
            h = int(hashlib.sha1(c.encode()).hexdigest(), 16) % 100 / 100
            split[c] = "train" if h < 0.7 else "val" if h < 0.8 else "test"
    SPLIT_FILE.write_text(json.dumps(dict(sorted(split.items())), indent=1) + "\n")
    return split


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", default="data/samples.jsonl")
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="data/dataset")
    ap.add_argument("--base-profile", default="data/profile.example.json")
    args = ap.parse_args()

    raw, out = Path(args.raw), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    base = json.loads(Path(args.base_profile).read_text(encoding="utf-8"))
    profiles = [synth_profile(base, i) for i in range(N_PROFILES)]

    forms: dict[str, list[dict]] = defaultdict(list)
    with open(args.samples, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            forms[row["form_id"]].append(row)
    split = load_split({slug(rows[0]["company"]): rows[0]["platform"] for rows in forms.values()})

    buckets: dict[str, list[str]] = {s: [] for s, _ in SPLITS}
    stats: Counter = Counter()
    for form_id, rows in sorted(forms.items()):
        rows.sort(key=lambda r: r["mark"])
        rec = json.loads((raw / f"{form_id}.json").read_text(encoding="utf-8"))
        bboxes = {m["mark"]: m["bbox"] for m in rec["marks"]}
        image = raw / f"{form_id}_marked.png"
        img_h, width = png_height(image), rec["viewport"]["width"]
        pid = int(hashlib.sha1(form_id.encode()).hexdigest(), 16) % N_PROFILES
        profile, s = profiles[pid], split[slug(rows[0]["company"])]

        examples = []
        for row in rows:
            target, thought, resolved = target_for(row, profile)
            examples.append(
                {
                    "row": row,
                    "target": target,
                    "thought": thought,
                    "resolved": resolved,
                    "crop": crop_for(bboxes[row["mark"]], img_h, width),
                }
            )
        # A choice group nobody clicked means the profile value matched none of its options; a "No"
        # with no matching option is fine (leave the boxes unchecked).
        groups = defaultdict(list)
        for e in examples:
            r = e["row"]
            if r["field_type"] in OPTION_TYPES and r["profile_key"]:
                groups[(r["profile_key"], r["group"] or r["label"])].append(e)
        for (key, _), g in groups.items():
            v = profile_value(profile, key, rows[0]["company"])
            if v not in (None, "No") and not any(e["target"]["action"] == "click" for e in g):
                for e in g:
                    e["resolved"] = False

        history: list[dict] = []
        for e in examples:
            row = e["row"]
            ambiguous = (
                row["ambiguous"]
                or (row["profile_key"] or "").startswith("eeo.")
                or row["field_type"] == "textarea"
            )
            write(
                buckets[s],
                stats,
                {
                    "id": f"{form_id}-{row['mark']}",
                    "form_id": form_id,
                    "company": slug(row["company"]),
                    "platform": row["platform"],
                    "split": s,
                    "image": image.as_posix(),
                    "crop": e["crop"],
                    "profile_id": pid,
                    "profile": profile,
                    "history": list(history),
                    "target": e["target"],
                    "thought": e["thought"],
                    "profile_key": row["profile_key"],
                    "field_type": row["field_type"],
                    "ambiguous": ambiguous,
                    "needs_review": row["needs_review"] or not e["resolved"],
                    "resolved": e["resolved"],
                },
            )
            history.append({k: v for k, v in e["target"].items() if v is not None})
        done = {"action": "done", "mark": None, "value": None}
        write(
            buckets[s],
            stats,
            {
                "id": f"{form_id}-done",
                "form_id": form_id,
                "company": slug(rows[0]["company"]),
                "platform": rows[0]["platform"],
                "split": s,
                "image": image.as_posix(),
                "crop": crop_for([0, img_h, 0, 0], img_h, width),  # form bottom (Submit), not a field
                "profile_id": pid,
                "profile": profile,
                "history": list(history),
                "target": done,
                "thought": "Every marked field is handled; stop and let the applicant review and submit.",
                "profile_key": None,
                "field_type": None,
                "ambiguous": False,
                "needs_review": False,
                "resolved": True,
            },
        )
    for s, lines in buckets.items():
        (out / f"{s}.jsonl").write_text("".join(lines), encoding="utf-8")
    write_card(stats, split, out)


def write(bucket: list[str], stats: Counter, ex: dict) -> None:
    ex["target_cot"] = render_target(ex["target"], ex["thought"])
    ex["target_no_cot"] = render_target(ex["target"], None)
    bucket.append(json.dumps(ex, ensure_ascii=False) + "\n")
    s, plat = ex["split"], ex["platform"]
    stats[(s, plat, "n")] += 1
    stats[(s, plat, "ambiguous")] += ex["ambiguous"]
    stats[(s, plat, "unresolved")] += not ex["resolved"]
    stats[(s, plat, "review")] += ex["needs_review"]
    stats[(s, "action", ex["target"]["action"])] += 1


def write_card(stats: Counter, split: dict, out: Path) -> None:
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], check=False, capture_output=True, text=True
    ).stdout.strip()
    plats = sorted({k[1] for k in stats if k[1] != "action"})
    lines = [
        "# Dataset card",
        "",
        f"Generated by `ml/build_dataset.py` at commit `{commit}`. Files: `{out.as_posix()}/{{train,val,test}}.jsonl` (gitignored).",
        "",
        "One example per marked field plus one `done` per form. Input: marked full-page screenshot cropped to a",
        f"{CROP_H}px window around the field, a synthetic profile ({N_PROFILES} variants of `profile.example.json`), and the",
        "previous actions. Targets come in two formats: `target_cot` (thought first) and `target_no_cot`.",
        "",
        "Split by company, stratified by platform (`ml/split.json`, frozen; never train on test). "
        + ", ".join(f"{s}: {sum(v == s for v in split.values())} companies" for s, _ in SPLITS)
        + ".",
        "",
        "| split | platform | examples | ambiguous | unresolved | needs review |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for s, _ in SPLITS:
        for p in plats:
            n = stats[(s, p, "n")]
            if n:
                cells = [
                    f"{stats[(s, p, k)]} ({100 * stats[(s, p, k)] / n:.0f}%)"
                    for k in ("ambiguous", "unresolved", "review")
                ]
                lines.append(f"| {s} | {p} | {n} | " + " | ".join(cells) + " |")
    lines += ["", "| split | " + " | ".join(a for a in ACTIONS) + " |", "|---|" + "---:|" * len(ACTIONS)]
    for s, _ in SPLITS:
        lines.append(f"| {s} | " + " | ".join(str(stats[(s, "action", a)]) for a in ACTIONS) + " |")
    lines += [
        "",
        "- **ambiguous**: the answer needs reasoning, not lookup (no profile key, custom/free-text questions,",
        "  how-did-you-hear, sponsorship, demographics, consents). The CoT ablation reports on this subset.",
        "- **unresolved**: the field is keyed but the profile value matched no option; the target is `skip`.",
        "- **needs review**: silver label flagged by `crawler/autolabel.py` or unresolved here.",
        "- Thoughts are templated from the label and profile key, not written by a person.",
        "",
    ]
    card = Path(__file__).with_name("DATASET.md")
    card.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


ACTIONS = ("type", "select", "click", "upload", "skip", "done")

if __name__ == "__main__":
    main()
