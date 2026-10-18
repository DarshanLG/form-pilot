# FormPilot

Vision-language-action agent that fills job applications from a screenshot and your profile.
SmolVLM + LoRA · FastAPI · React · Express · MongoDB.

See `ROADMAP.md` for the plan.

## Quick start (Phase 1)
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && playwright install chromium
python crawler/capture.py --url "https://job-boards.greenhouse.io/<company>/jobs/<id>" --headed
python crawler/autolabel.py
```
Outputs land in `data/raw/` (screenshots + marks) and `data/samples.jsonl` (silver labels).
