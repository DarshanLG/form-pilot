"""Silver-label captured forms: map each mark to a profile key and an action.

Usage:
    python crawler/autolabel.py --raw data/raw --out data/samples.jsonl

Output: one JSON line per field:
  {form_id, company, platform, mark, label, group, ..., profile_key, option, action, ambiguous, needs_review}
Hand-review rows with needs_review=true (and a random 10% of the rest).
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

# (regex on the field's question text, profile key, action). First match wins; order matters.
# SHORT rules are direct lookups and only apply to short labels: "Phone" is a phone field,
# "Do you have consistent phone access?" is not.
SHORT: list[tuple[str, str, str]] = [
    (r"resume|\bcv\b", "files.resume", "upload"),
    (r"cover\s*letter", "files.cover_letter", "upload"),
    (r"preferred\s*(first\s*)?name", "name.preferred", "type"),
    (r"first\s*name|given\s*name", "name.first", "type"),
    (r"last\s*name|surname|family\s*name", "name.last", "type"),
    (r"^(full\s*|legal\s*)?name\b", "name.full", "type"),
    (r"e-?mail", "email", "type"),
    (r"phone|mobile", "phone", "type"),
    (r"linkedin", "links.linkedin", "type"),
    (r"github", "links.github", "type"),
    (r"twitter|\bx\.com", "links.twitter", "type"),
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
]
QUESTION: list[tuple[str, str, str]] = [
    (r"preferred\s*(first\s*|full\s*)?name|would you like (us )?to call you", "name.preferred", "type"),
    (r"current\s*(or\s*previous\s*)?(company|employer)", "work.0.company", "type"),
    (r"what city", "location.city", "type"),
    (r"pronoun", "pronouns", "click"),
    (r"countr(y|ies)\b.{0,30}\b(reside|residence|live)", "location.country", "select"),
    (
        r"^(are|is)\s+(you|the candidate)\s+(legally\s+)?(authori[sz]ed|eligible)",
        "work_authorization.authorized_us",
        "select",
    ),
    (r"(requir|need)\w*\b.{0,60}sponsor", "work_authorization.needs_sponsorship", "select"),
    (r"authori[sz]ed|legally\s*(able|eligible)", "work_authorization.authorized_us", "select"),
    (r"sponsor", "work_authorization.needs_sponsorship", "select"),
    (r"(live|located|reside)\w*\s+in\s+the\s+(us\b|u\.s|united states)", "location.country", "select"),
    (r"relocat", "preferences.relocate", "select"),
    (r"notice\s*period", "preferences.notice_period", "select"),
    (r"start\s*date|available\s*to\s*start", "preferences.start_date", "type"),
    (r"salary|compensation\s*expect", "preferences.salary_expectation", "type"),
    (r"(previously|ever|been)\s+(been\s+)?(employed|worked)", "answers.previously_employed_at", "select"),
    (r"^race\b|\brace\b.{0,15}ethnic", "eeo.race", "select"),  # before hispanic: race options list it
    (r"hispanic|latin[oa]", "eeo.hispanic", "select"),
    (r"lgbt", "eeo.lgbtq", "select"),
    (r"sexual\s*orientation", "eeo.sexual_orientation", "select"),
    (r"\bage\s*range|what age are you|\byour age\b", "eeo.age", "select"),
    (r"religio", "eeo.religion", "select"),
    (r"highest\s*(level\s*of\s*)?education", "education.0.degree", "select"),
    (r"^end\s*date\s*(month|year)", "education.0.end", "select"),
    (r"gender", "eeo.gender", "select"),
    (r"\brace\b|ethnic", "eeo.race", "select"),
    (r"veteran|military", "eeo.veteran", "select"),
    (r"disabilit", "eeo.disability", "select"),
    (r"language", "languages", "click"),
    (
        r"how\s*(did|'d)\s*you\s*(first\s*)?(hear|find|learn)|where\s*(did|have)\s*you\s*(first\s*)?(hear|seen)"
        r"|\bsource\b|\breferr(al|ed by)",
        "answers.how_did_you_hear",
        "select",
    ),
    (r"opt.?in|whatsapp|text messages|future (job )?opportunit|marketing", "consent.marketing", "click"),
]
SHORT_MAX = 50  # chars of question text (after stripping required markers) for SHORT rules

# Fields where the right answer needs reasoning, not lookup -> CoT ablation subset.
AMBIGUOUS_KEYS = {
    "name.preferred",
    "answers.how_did_you_hear",
    "answers.previously_employed_at",
    "preferences.salary_expectation",
    "preferences.notice_period",
    "work_authorization.needs_sponsorship",
    "work_authorization.authorized_us",
    "preferences.relocate",
    "consent.marketing",  # consents are the user's call
    "location.city",
}
OPTION_TYPES = ("radio", "checkbox")
# Required legal acknowledgements: never silver-label as auto-click; the user decides.
ACKNOWLEDGE = r"\bi\s+(acknowledge|consent|agree|certify|understand)|by checking|acknowledge/confirm"


def question_of(m: dict, solo: bool) -> str:
    # An option's own label is "Yes"/"Male"; the question is its group. A lone checkbox with a
    # full-sentence label ("I consent to ...") is its own question; capture can give it a
    # neighbouring section's label as group.
    if m.get("type") in OPTION_TYPES and m.get("group") and not (solo and len(m.get("label", "")) > 40):
        return m["group"]
    return " ".join(filter(None, [m.get("label"), m.get("name"), m.get("placeholder")]))


def action_for(m: dict) -> str:
    """The action follows from the widget, not the question."""
    typ = m.get("type")
    if typ == "file":
        return "upload"
    if typ in OPTION_TYPES:
        return "click"  # one mark per option; Phase 2 decides click vs skip from the profile value
    if m.get("tag") == "select" or typ in ("combobox", "listbox"):
        return "select"
    return "type"


def label_field(m: dict, solo: bool = False) -> dict:
    """`solo`: the mark is the only option with its input name on the form."""
    q = question_of(m, solo).lower()
    q = re.sub(r"[*✱]|\(optional\)", " ", q).strip()
    head = re.sub(r"\s+", " ", m.get("label", "").lower())
    head = re.sub(r"[*✱]|\(optional\)", "", head).strip() if m.get("type") not in OPTION_TYPES else q
    key = None
    rules = (SHORT if len(head) <= SHORT_MAX else []) + QUESTION
    for pat, k, _ in rules:
        if re.search(pat, q):
            key = k
            break
    typ = m.get("type")
    if typ == "file":
        key = key if key and key.startswith("files.") else "files.resume"
    elif key and key.startswith("files."):
        key = None  # e.g. Lever's "Additional information" textarea mentions a cover letter
    acknowledge = key is None and bool(re.search(ACKNOWLEDGE, q))
    # Needs an answer, not a lookup: any unkeyed choice, or a long free-text prompt.
    choice = typ in OPTION_TYPES or action_for(m) == "select"
    custom_question = key is None and not acknowledge and (choice or m.get("required") or len(q) > 40)
    ambiguous = key in AMBIGUOUS_KEYS or custom_question or acknowledge
    return {
        "profile_key": key,
        "option": m.get("label", "") if typ in OPTION_TYPES else None,
        "action": action_for(m) if key or custom_question or acknowledge else "skip",
        "ambiguous": ambiguous,
        "needs_review": key is None or ambiguous,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="data/samples.jsonl")
    args = ap.parse_args()

    n_forms = n_fields = n_review = 0
    with open(args.out, "w", encoding="utf-8") as fh:
        for f in sorted(Path(args.raw).glob("*.json")):
            rec = json.loads(f.read_text(encoding="utf-8"))
            n_forms += 1
            names = Counter(m["name"] for m in rec["marks"] if m["type"] in OPTION_TYPES and m["name"])
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
                    **label_field(m, solo=names[m["name"]] <= 1),
                }
                n_fields += 1
                n_review += row["needs_review"]
                fh.write(json.dumps(row) + "\n")
    print(f"{n_forms} forms, {n_fields} fields, {n_review} need review -> {args.out}")


if __name__ == "__main__":
    main()
