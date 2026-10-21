"""LoRA fine-tune SmolVLM on the train split (PEFT + TRL SFT).

Usage:
    python ml/train_lora.py --name lora-256m-nocot
    python ml/train_lora.py --name lora-256m-cot --cot
    python ml/eval.py --adapter checkpoints/lora-256m-nocot --name lora-256m-nocot --log

Loss is on the assistant's answer only (prompt, image and padding are masked). LoRA goes on the text
model's attention + MLP projections; the vision encoder stays frozen. Never touches the test split.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import torch
from peft import LoraConfig
from transformers import AutoModelForVision2Seq, AutoProcessor
from trl import SFTConfig, SFTTrainer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.prompt import load_image, messages, render_target

ACTIONS = ("type", "select", "click", "upload", "skip", "done")
TEXT_PROJ = r".*text_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)"


class Collator:
    def __init__(self, processor, cot: bool):
        self.processor, self.cot = processor, cot

    def texts(self, ex: dict) -> tuple[str, str]:
        msgs = messages(ex["profile"], ex["history"], self.cot)
        prompt = self.processor.apply_chat_template(msgs, add_generation_prompt=True)
        answer = render_target(ex["target"], ex["thought"] if self.cot else None)
        full = self.processor.apply_chat_template(
            msgs + [{"role": "assistant", "content": [{"type": "text", "text": answer}]}]
        )
        return prompt, full

    def __call__(self, batch: list[dict]) -> dict:
        prompts, fulls = zip(*(self.texts(ex) for ex in batch))
        images = [[load_image(ex)] for ex in batch]
        enc = self.processor(text=list(fulls), images=images, return_tensors="pt", padding=True)
        labels = enc["input_ids"].clone()
        labels[enc["attention_mask"] == 0] = -100
        for i, (prompt, img) in enumerate(zip(prompts, images)):
            n_prompt = self.processor(text=prompt, images=img, return_tensors="pt")["input_ids"].shape[1]
            labels[i, :n_prompt] = -100
        enc["labels"] = labels
        return enc


def parse_oversample(spec: str) -> dict[str, int]:
    """Parse e.g. click=5,done=4 into {"click": 5, "done": 4}."""
    out = {}
    for part in filter(None, spec.split(",")):
        action, _, n = part.partition("=")
        if action not in ACTIONS or not n.isdigit() or int(n) < 1:
            raise argparse.ArgumentTypeError(
                f"bad --oversample entry {part!r}: want <action>=<count>, count >= 1"
            )
        out[action] = int(n)
    return out


def oversample(train: list[dict], factors: dict[str, int]) -> list[dict]:
    """The model learned "radio/checkbox -> skip" because click is ~3% of train (done ~4%): repeat those
    examples. The trainer's sampler shuffles, so copies are spread over the epoch."""
    if not factors:
        return train
    out = [ex for ex in train for _ in range(factors.get(ex["target"]["action"], 1))]
    before, after = (
        Counter(ex["target"]["action"] for ex in train),
        Counter(ex["target"]["action"] for ex in out),
    )
    print("oversample:", {a: f"{before[a]}->{after[a]}" for a in factors}, f"total {len(train)}->{len(out)}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="adapter goes to checkpoints/<name>")
    ap.add_argument("--model", default="HuggingFaceTB/SmolVLM-256M-Instruct")
    ap.add_argument("--data", default="data/dataset")
    ap.add_argument("--cot", action="store_true", help="train on the with_cot targets")
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--grad-accum", type=int, default=16)
    ap.add_argument("--longest-edge", type=int, default=1024, help="must match ml/eval.py")
    ap.add_argument("--max-steps", type=int, default=-1, help="smoke tests")
    ap.add_argument(
        "--oversample",
        type=parse_oversample,
        default={},
        help="repeat rare target actions, e.g. click=5,done=4 (each such example appears N times per epoch)",
    )
    args = ap.parse_args()

    with open(Path(args.data) / "train.jsonl", encoding="utf-8") as fh:
        train = [json.loads(line) for line in fh]
    assert all(ex["split"] == "train" for ex in train)
    train = oversample(train, args.oversample)

    cap = torch.cuda.get_device_capability()[0] if torch.cuda.is_available() else 0
    bf16 = cap >= 8
    fp16 = cap == 7  # Turing/Volta (Colab T4): fp32 weights + fp16 autocast. Pascal (GTX 10xx): fp32 only
    vram = torch.cuda.get_device_properties(0).total_memory / 2**30 if cap else 0
    grad_ckpt = vram < 12  # recomputing activations only pays off when memory is tight
    processor = AutoProcessor.from_pretrained(args.model)
    processor.image_processor.size = {"longest_edge": args.longest_edge}
    model = AutoModelForVision2Seq.from_pretrained(
        args.model, dtype=torch.bfloat16 if bf16 else torch.float32
    )

    out = Path("checkpoints") / args.name
    config = SFTConfig(
        output_dir=str(out),
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        bf16=bf16,
        fp16=fp16,
        gradient_checkpointing=grad_ckpt,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        logging_steps=5,
        save_steps=100,
        save_total_limit=2,
        report_to="none",
        remove_unused_columns=False,
        dataset_kwargs={"skip_prepare_dataset": True},
        dataloader_num_workers=0,
    )
    lora = LoraConfig(
        r=args.rank,
        lora_alpha=2 * args.rank,
        lora_dropout=0.05,
        target_modules=TEXT_PROJ,
        task_type="CAUSAL_LM",
    )
    trainer = SFTTrainer(
        model=model,
        args=config,
        train_dataset=train,
        data_collator=Collator(processor, args.cot),
        peft_config=lora,
        processing_class=processor,
    )
    trainer.model.print_trainable_parameters()
    trainer.train(resume_from_checkpoint=any(out.glob("checkpoint-*")) or None)
    trainer.save_model(str(out))
    print(f"adapter -> {out}")


if __name__ == "__main__":
    main()
