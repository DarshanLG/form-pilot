"""Run a SmolVLM (optionally + LoRA adapter) on one dataset example -> raw model output text.

Used by ml/eval.py now and by inference/ later.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.prompt import load_image, messages

PREFILL = {True: '{"thought": "', False: '{"action": "'}


class Predictor:
    def __init__(self, model_id: str, adapter: str | None = None, longest_edge: int = 1024):
        import torch
        from transformers import AutoModelForVision2Seq, AutoProcessor

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
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
        model = AutoModelForVision2Seq.from_pretrained(model_id, torch_dtype=dtype)
        if adapter:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter)
        self.model = model.to(self.device).eval()

    def __call__(self, ex: dict, cot: bool, prefill: bool = False, max_new_tokens: int | None = None) -> str:
        """`prefill`: start the answer with the JSON's first key so the model continues the object."""
        start = PREFILL[cot] if prefill else ""
        prompt = self.processor.apply_chat_template(
            messages(ex["profile"], ex["history"], cot), add_generation_prompt=True
        )
        prompt += start
        inputs = self.processor(text=prompt, images=[load_image(ex)], return_tensors="pt").to(self.device)
        inputs = {k: v.to(self.model.dtype) if v.is_floating_point() else v for k, v in inputs.items()}
        with self.torch.inference_mode():
            out = self.model.generate(
                **inputs, max_new_tokens=max_new_tokens or (160 if cot else 64), do_sample=False
            )
        return (
            start
            + self.processor.decode(out[0, inputs["input_ids"].shape[1] :], skip_special_tokens=True).strip()
        )
