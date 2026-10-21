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
  - `crawler/collect_urls.py` pulls from the public board APIs (Lever slugs found via `site:jobs.lever.co` searches).
    GH 154 + Lever 151, 1 job/company → 305 forms, 7,616 fields, 5,876 keyed, 3,144 flagged `needs_review`. Workday: 0.
- [ ] Run capture on all; handle multi-page Workday (capture each step)
- [ ] Hand-review ~10% of labels in a tiny review UI (or a notebook)
- **Done when:** ≥300 forms, ≥5k labeled fields in `data/samples.jsonl`

## Phase 2 — Dataset build (Week 2)
- [x] `ml/build_dataset.py` — one example per field: (screenshot crop/full + marks, profile JSON, history) → target action JSON
  - 900px crop around each mark, 50 synthetic profiles (never the real one), + one `done` per form. Prompt format in `ml/prompt.py`.
- [x] Split **by company domain**, not random: train 70 / val 10 / test 20 (stratified by platform, frozen in `ml/split.json`)
- [x] Tag "ambiguous" fields (no direct profile key, free-text, "how did you hear", demographic, custom questions) → `ambiguous: true`
- [x] Two target formats: `with_cot` (`thought` before action) and `no_cot` (thoughts are templated, not human-written)
- **Done when:** frozen test split + dataset card (counts per platform, % ambiguous) → `ml/DATASET.md`

## Phase 3 — Baseline (Week 2)
- [x] `ml/eval.py` — action accuracy = action type + mark + value all correct (value: normalized exact match; free text: judged separately)
  - Reference: `always-skip` (no model) scores 44.2% overall / 63.2% ambiguous; every model must beat it. `--prefill` starts answers with `{"action": "`.
- [x] Zero-shot SmolVLM baseline on test split → record in `ml/RESULTS.md`
  - 256M + prefill: 2.3% overall / 1.7% ambiguous, 87.7% valid JSON, 4.8 s/example — far below `always-skip`.

## Phase 4 — LoRA fine-tune (Week 3)
- [ ] `ml/train_lora.py` (PEFT + TRL SFT), r=16, target attn+MLP proj, bf16
  - Written; label masking verified (loss only on the answer JSON). fp32 on the GTX 1050 Ti (no bf16 on Pascal). Not yet run.
  - Local 1050 Ti: ~7 s/example, ~11 h/epoch, OOMs when the desktop needs VRAM. Long runs go to Colab (T4, fp16):
    `python ml/colab_bundle.py` → upload zip to Drive → `ml/colab.ipynb` → `--unpack` the result zip.
- [ ] Train `no_cot` → eval on held-out layouts
- [ ] Train `with_cot` → eval; report delta on `ambiguous` subset
  - `lora-cot` (Colab): 64.9% overall / 66.0% ambiguous vs always-skip 44.2% / 63.2%. click and done 0%, upload 35.7%.
    Delta needs `lora-nocot`; the local no_cot run OOMed twice (partial in `checkpoints/lora-nocot-local-partial`).
- [ ] Push adapter to Hugging Face Hub
- **Done when:** RESULTS.md has baseline vs LoRA vs LoRA+CoT, overall + per platform + ambiguous

## Phase 5 — Inference service (Week 4)
- [x] `inference/` FastAPI: `POST /act` {screenshot, marks, profile, history} → action JSON
  - `uvicorn inference.server:app --host 127.0.0.1 --port 8000`; `FORMPILOT_ADAPTER` loads a LoRA. Tests: `pytest inference`.
- [x] JSON-schema-constrained decoding / retry on invalid output
  - Prefill `{"action": "` + stop at `}` + schema check (action, mark on screen, value rules); 2 sampled retries,
    then `skip` with `fallback: true`. Not token-level constrained decoding.
- [ ] Latency target < 2s/step on GPU (note CPU fallback speed honestly)
  - GTX 1050 Ti fp32, 256M: ~4–5 s/step before the stop-at-`}` fix (re-measure). CPU: ~25 s/step.

## Phase 6 — App (Weeks 4–5)
- [x] `server/` Express + MongoDB: profiles, resumes/cover letters (GridFS), runs, corrections
  - `cd server && npm start` → http://127.0.0.1:4000 (env `MONGO_URL`, `INFERENCE_URL`). `npm test` needs a local mongod.
  - `/api/profile`, `/api/files/:kind`, `/api/runs` (+ `/:id/steps`, `/:id/finish`), `/api/corrections[/export]`,
    `/api/stats` (acceptance rate per day), `/api/act` (proxy to the model server with the stored profile).
    Edited/overridden steps become corrections with their screenshot; export is NDJSON for Phase 7.
- [x] `extension/` Chrome MV3 + React side panel (tested end to end on a live Lever form with `lora-cot`)
  - `cd extension && npm run build` → chrome://extensions → Load unpacked → `extension/dist`. `npm test` (jsdom).
  - Marking mirrors `crawler/capture.py` (same 18 marks/labels as the crawl on a live Lever form) with v2
    left-side radio/checkbox numbers: retrain on `data/dataset_v2` before relying on clicks.
  - [x] capture tab screenshot, inject marks, call API, execute action, show live step log
    (autocomplete fields pick a suggestion; a clicked radio auto-skips its siblings)
  - [x] Accept / Edit / Skip per action → edits saved as corrections (no-op edits count as accepts)
  - [x] resume/cover letter upload into file inputs
  - [x] **Confirm-before-submit** gate
- [x] `web/` React dashboard: profile editor, application history, accuracy over time
  - `cd web && npm run dev` → http://127.0.0.1:5173 (proxies `/api` to the server). `npm test`.
  - Overview (acceptance rate per day, corrections export), Profile (form or raw JSON), Documents, Runs (steps).

## Phase 7 — Feedback loop (Week 6)
- [ ] Export corrections → append to train set → retrain → compare on the same frozen test split
- [ ] Chart: accuracy vs. # corrections

## Phase 8 — Polish (Week 6)
- [ ] Demo GIF/video, README with architecture diagram + results table
- [ ] Final numbers → resume bullet
