"""Silver-label captured forms: map each mark to a profile key and an action.

Usage:
    python crawler/autolabel.py --raw data/raw --out data/samples.jsonl

Output: one JSON line per field:
  {form_id, company, platform, mark, label, profile_key, action, ambiguous, needs_review}
Hand-review rows with needs_review=true (and a random 10% of the rest).
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# (regex on label/name/placeholder, profile key, action). First match wins; order matters.
RULES: list[tuple[str, str, str]] = [
    (r"resume|cv\b", "files.resume", "upload"),
    (r"cover\s*letter", "files.cover_letter", "upload"),
    (r"preferred\s*(first\s*)?name", "name.preferred", "type"),
    (r"first\s*name|given\s*name", "name.first", "type"),
    (r"last\s*name|surname|family\s*name", "name.last", "type"),
    (r"^(full\s*)?name\b", "name.full", "type"),
    (r"e-?mail", "email", "type"),
    (r"phone|mobile", "phone", "type"),
    (r"linkedin", "links.linkedin", "type"),
    (r"github", "links.github", "type"),
    (r"portfolio|website|personal\s*site", "links.portfolio", "type"),
    (r"\bcity\b|location", "location.city", "type"),
    (r"\bstate\b|province", "location.state", "select"),
    (r"country", "location.country", "select"),
    (r"zip|postal", "location.zip", "type"),
    (r"school|university|college", "education.0.school", "type"),
    (r"degree", "education.0.degree", "select"),
    (r"discipline|major|field of study", "education.0.field", "type"),
    (r"\bgpa\b", "education.0.gpa", "type"),
    (r"current\s*(company|employer)", "work.0.company", "type"),
    (r"current\s*(title|role)|job\s*title", "work.0.title", "type"),
    (r"sponsor", "work_authorization.needs_sponsorship", "select"),
    (r"authori[sz]ed|legally\s*(able|eligible)", "work_authorization.authorized_us", "select"),
    (r"relocat", "preferences.relocate", "select"),
    (r"start\s*date|available\s*to\s*start", "preferences.start_date", "type"),
    (r"salary|compensation", "preferences.salary_expectation", "type"),
    (r"gender", "eeo.gender", "select"),
    (r"race|ethnic", "eeo.race", "select"),
    (r"veteran", "eeo.veteran", "select"),
    (r"disabilit", "eeo.disability", "select"),
    (r"how\s*did\s*you\s*(hear|find)|source|referr", "answers.how_did_you_hear", "select"),
]

# Fields where the right answer needs reasoning, not lookup -> CoT ablation subset.
AMBIGUOUS_KEYS = {
    "name.preferred",
    "answers.how_did_you_hear",
    "preferences.salary_expectation",
    "work_authorization.needs_sponsorship",
    "work_authorization.authorized_us",
    "preferences.relocate",
    "location.city",
}


def label_field(m: dict) -> dict:
    text = " ".join(
        [m.get("group", ""), m.get("label", ""), m.get("name", ""), m.get("placeholder", "")]
    ).lower()
    key, action = None, None
    for pat, k, a in RULES:
        if re.search(pat, text):
            key, action = k, a
            break
    if m.get("type") == "file":
        action = "upload"
        key = key if key and key.startswith("files.") else "files.resume"
    if m.get("tag") == "select" or m.get("type") in ("combobox", "listbox", "radio"):
        action = "select" if key else action
    if m.get("type") == "checkbox":
        action = "click"
    custom_question = key is None and len(m.get("label", "")) > 40  # long free-text prompt
    return {
        "profile_key": key,
        "action": action or ("type" if custom_question else "skip"),
        "ambiguous": key in AMBIGUOUS_KEYS or custom_question,
        "needs_review": key is None or bool(m.get("options")) and action == "select",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="data/samples.jsonl")
    args = ap.parse_args()

    n_forms = n_fields = n_review = 0
    with open(args.out, "w") as fh:
        for f in sorted(Path(args.raw).glob("*.json")):
            rec = json.loads(f.read_text())
            n_forms += 1
            for m in rec["marks"]:
                row = {
                    "form_id": rec["id"],
                    "company": rec["company"],
                    "platform": rec["platform"],
                    "mark": m["mark"],
                    "label": m["label"],
                    "group": m.get("group", ""),
                    "field_type": m["type"],
                    "options": m["options"],
                    "required": m["required"],
                    **label_field(m),
                }
                n_fields += 1
                n_review += row["needs_review"]
                fh.write(json.dumps(row) + "\n")
    print(f"{n_forms} forms, {n_fields} fields, {n_review} need review -> {args.out}")


if __name__ == "__main__":
    main()
