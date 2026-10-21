"""Pack code + dataset into one zip for Google Colab (see ml/colab.ipynb).

Usage:
    python ml/colab_bundle.py                                   # code + dataset
    python ml/colab_bundle.py --adapter checkpoints/lora-nocot  # also ship a trained adapter to eval
    python ml/colab_bundle.py --data data/dataset_v2            # another dataset build (lands as data/dataset)

Upload data/colab/formpilot_colab.zip to "My Drive/formpilot/". Code travels as a git bundle of HEAD, so
the commit hash survives and no push is needed: commit first. Only the marked screenshots the dataset
references are included. Colab results come back as formpilot_out_<name>.zip; unpack with --unpack.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "colab"
SPLITS = ["train", "val", "test"]


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def pack(adapter: str | None, data: str) -> None:
    if git("status", "--porcelain", "--untracked-files=no").strip():
        sys.exit("working tree has uncommitted changes: commit first so Colab runs a real commit")
    OUT.mkdir(parents=True, exist_ok=True)
    bundle = OUT / "repo.bundle"
    git("bundle", "create", str(bundle), "HEAD", "main")

    images: set[str] = set()
    for split in SPLITS:
        with open(ROOT / data / f"{split}.jsonl", encoding="utf-8") as fh:
            images.update(json.loads(line)["image"] for line in fh)

    dest = OUT / "formpilot_colab.zip"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED) as z:  # PNGs and the bundle are already compressed
        z.write(bundle, "repo.bundle")
        for split in SPLITS:
            z.write(ROOT / data / f"{split}.jsonl", f"data/dataset/{split}.jsonl")  # notebook default path
        for img in sorted(images):
            z.write(ROOT / img, img)
        if adapter:
            src = ROOT / adapter
            for f in src.iterdir():  # final adapter only, not checkpoint-* dirs
                if f.is_file():
                    z.write(f, f"checkpoints/{src.name}/{f.name}")
    bundle.unlink()
    rev = git("rev-parse", "--short", "HEAD").strip()
    print(f"{dest}  ({dest.stat().st_size / 2**20:.0f} MB, commit {rev}, {len(images)} screenshots)")


def unpack(path: str) -> None:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.startswith(("checkpoints/", "data/runs/"))]
        z.extractall(ROOT, names)
    print("\n".join(names))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", help="also include this trained adapter dir (to eval it on Colab)")
    ap.add_argument("--data", default="data/dataset", help="dataset dir to ship (its screenshots come along)")
    ap.add_argument("--unpack", help="extract a formpilot_out_<name>.zip from Colab into the repo")
    args = ap.parse_args()
    unpack(args.unpack) if args.unpack else pack(args.adapter, args.data)


if __name__ == "__main__":
    main()
