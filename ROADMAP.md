# FormPilot Roadmap

Vision-language-action agent that fills job applications (Workday, Greenhouse, Lever) from a screenshot + your profile.

Target resume claims — **only keep a number once the eval in Phase 4/5 produces it:**
- Action accuracy on held-out layouts (target ~87%)
- CoT gain on ambiguous fields (target ~+11 pts)
- React + Express + MongoDB app logging user corrections for retraining

---

## Phase 0 — Repo & profile (Day 1)
- [x] Repo skeleton, roadmap
- [x] `data/profile.example.json` — profile schema
- [ ] Copy to `data/profile.json` with your real info (gitignored)

## Phase 1 — Data capture (Week 1)
- [x] `crawler/capture.py` — screenshot + numbered marks (set-of-marks) + field metadata per form
- [x] `crawler/autolabel.py` — silver labels: mark → profile key → action
- [ ] Collect URLs: ~150 Greenhouse, ~150 Lever, ~50 Workday (`data/urls/*.txt`)
- [ ] Run capture on all; handle multi-page Workday (capture each step)
- [ ] Hand-review ~10% of labels in a tiny review UI (or a notebook)
- **Done when:** ≥300 forms, ≥5k labeled fields in `data/samples.jsonl`

## Phase 2 — Dataset build (Week 2)
- [ ] `ml/build_dataset.py` — one example per field: (screenshot crop/full + marks, profile JSON, history) → target action JSON
- [ ] Split **by company domain**, not random: train 70 / val 10 / test 20
- [ ] Tag "ambiguous" fields (no direct profile key, free-text, "how did you hear", demographic, custom questions) → `ambiguous: true`
- [ ] Two target formats: `with_cot` (`thought` before action) and `no_cot`
- **Done when:** frozen test split + dataset card (counts per platform, % ambiguous)

## Phase 3 — Baseline (Week 2)
- [ ] `ml/eval.py` — action accuracy = action type + mark + value all correct (value: normalized exact match; free text: judged separately)
- [ ] Zero-shot SmolVLM baseline on test split → record in `ml/RESULTS.md`

## Phase 4 — LoRA fine-tune (Week 3)
- [ ] `ml/train_lora.py` (PEFT + TRL SFT), r=16, target attn+MLP proj, bf16
- [ ] Train `no_cot` → eval on held-out layouts
- [ ] Train `with_cot` → eval; report delta on `ambiguous` subset
- [ ] Push adapter to Hugging Face Hub
- **Done when:** RESULTS.md has baseline vs LoRA vs LoRA+CoT, overall + per platform + ambiguous

## Phase 5 — Inference service (Week 4)
- [ ] `inference/` FastAPI: `POST /act` {screenshot, marks, profile, history} → action JSON
- [ ] JSON-schema-constrained decoding / retry on invalid output
- [ ] Latency target < 2s/step on GPU (note CPU fallback speed honestly)

## Phase 6 — App (Weeks 4–5)
- [ ] `server/` Express + MongoDB: profiles, resumes/cover letters (GridFS), runs, corrections
- [ ] `extension/` Chrome MV3 + React side panel:
  - capture tab screenshot, inject marks, call API, execute action, show live step log
  - Accept / Edit / Skip per action → edits saved as corrections
  - resume/cover letter upload into file inputs
  - **Confirm-before-submit** gate
- [ ] `web/` React dashboard: profile editor, application history, accuracy over time

## Phase 7 — Feedback loop (Week 6)
- [ ] Export corrections → append to train set → retrain → compare on the same frozen test split
- [ ] Chart: accuracy vs. # corrections

## Phase 8 — Polish (Week 6)
- [ ] Demo GIF/video, README with architecture diagram + results table
- [ ] Final numbers → resume bullet
