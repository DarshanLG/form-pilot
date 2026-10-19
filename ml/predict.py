"""Run a SmolVLM (optionally + LoRA adapter) on one dataset example -> raw model output text.

Used by ml/eval.py and inference/server.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.prompt import load_image, messages

PREFILL = {True: '{"thought": "', False: '{"action": "'}


class Predictor:
    def __init__(
        self, model_id: str, adapter: str | None = None, longest_edge: int = 1024, device: str | None = None
    ):
        import torch
        from transformers import AutoModelForVision2Seq, AutoProcessor

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        # Pascal GPUs (GTX 10xx) have no bf16 and crippled fp16 throughput: use fp32 there.
        if self.device == "cuda" and torch.cuda.get_device_capability()[0] >= 8:
            dtype = torch.bfloat16
        elif self.device == "cuda" and torch.cuda.get_device_capability()[0] >= 7:
            dtype = torch.float16
        else:
            dtype = torch.float32
        self.processor = AutoProcessor.from_pretrained(model_id)
        # Image tokens grow with resolution; 1024 keeps a 1280x900 crop at 4 tiles + 1 global.
        self.processor.image_processor.size = {"longest_edge": longest_edge}
        model = AutoModelForVision2Seq.from_pretrained(model_id, dtype=dtype)
        if adapter:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter)
        self.model = model.to(self.device).eval()

    def __call__(self, ex: dict, cot: bool, prefill: bool = False) -> str:
        """Predict for a dataset example (ml/eval.py)."""
        return self.generate(load_image(ex), ex["profile"], ex["history"], cot, prefill)

    def generate(
        self,
        image,
        profile: dict,
        history: list[dict],
        cot: bool,
        prefill: bool = False,
        sample: bool = False,
    ) -> str:
        """`image`: PIL viewport screenshot with marks. `prefill`: start the answer with the JSON's first
        key so the model continues the object. `sample`: temperature sampling (retries after bad output)."""
        start = PREFILL[cot] if prefill else ""
        prompt = self.processor.apply_chat_template(
            messages(profile, history, cot), add_generation_prompt=True
        )
        inputs = self.processor(text=prompt + start, images=[image], return_tensors="pt").to(self.device)
        inputs = {k: v.to(self.model.dtype) if v.is_floating_point() else v for k, v in inputs.items()}
        gen = {"do_sample": True, "temperature": 0.7} if sample else {"do_sample": False}
        with self.torch.inference_mode():
            # Answers are one flat JSON object: stop at its closing brace instead of rambling on.
            out = self.model.generate(
                **inputs,
                max_new_tokens=160 if cot else 64,
                stop_strings=["}"],
                tokenizer=self.processor.tokenizer,
                **gen,
            )
        text = self.processor.decode(out[0, inputs["input_ids"].shape[1] :], skip_special_tokens=True)
        return start + text.strip()
