# Results

Every number here comes from `ml/eval.py`. Newest last.

## always-skip · test · 2026-10-18 · commit `97bf9ec-dirty`

Model `always-skip`, format `no_cot`, longest_edge 1024, n=1544, 0.00 s/example.

| subset | n | action acc | action-type acc | valid JSON |
|---|---:|---:|---:|---:|
| overall | 1530 | 44.2% | 44.2% | 100.0% |
| unambiguous | 729 | 23.3% | 23.3% | 100.0% |
| ambiguous | 801 | 63.2% | 63.2% | 100.0% |
| greenhouse | 730 | 34.2% | 34.2% | 100.0% |
| lever | 800 | 53.2% | 53.2% | 100.0% |
| action:click | 34 | 0.0% | 0.0% | 100.0% |
| action:done | 61 | 0.0% | 0.0% | 100.0% |
| action:select | 239 | 0.0% | 0.0% | 100.0% |
| action:skip | 676 | 100.0% | 100.0% | 100.0% |
| action:type | 436 | 0.0% | 0.0% | 100.0% |
| action:upload | 84 | 0.0% | 0.0% | 100.0% |
| free_text | 14 | 0.0% | 0.0% | 100.0% |

## zs-256m-pf · test · 2026-10-19 · commit `bb0d498`

Model `HuggingFaceTB/SmolVLM-256M-Instruct`, format `no_cot`, prefill, longest_edge 1024, n=1544, 4.80 s/example.

| subset | n | action acc | action-type acc | valid JSON |
|---|---:|---:|---:|---:|
| overall | 1530 | 2.3% | 12.5% | 87.7% |
| unambiguous | 729 | 2.9% | 17.8% | 84.4% |
| ambiguous | 801 | 1.7% | 7.6% | 90.8% |
| greenhouse | 730 | 4.7% | 24.5% | 91.0% |
| lever | 800 | 0.1% | 1.5% | 84.8% |
| action:click | 34 | 2.9% | 5.9% | 70.6% |
| action:done | 61 | 3.3% | 3.3% | 90.2% |
| action:select | 239 | 0.4% | 12.6% | 93.7% |
| action:skip | 676 | 0.4% | 0.6% | 88.2% |
| action:type | 436 | 6.4% | 34.6% | 86.9% |
| action:upload | 84 | 0.0% | 2.4% | 76.2% |
| free_text | 14 | 0.0% | 57.1% | 92.9% |

## lora-cot · test · 2026-10-20 · commit `1a5fade`

Model `HuggingFaceTB/SmolVLM-256M-Instruct` + adapter `checkpoints/lora-cot`, format `with_cot`, prefill, longest_edge 1024, n=1544.

| subset | n | action acc | action-type acc | valid JSON |
|---|---:|---:|---:|---:|
| overall | 1530 | 64.9% | 69.8% | 98.8% |
| unambiguous | 729 | 63.6% | 67.8% | 99.2% |
| ambiguous | 801 | 66.0% | 71.7% | 98.4% |
| greenhouse | 730 | 52.9% | 60.1% | 98.9% |
| lever | 800 | 75.9% | 78.6% | 98.6% |
| action:click | 34 | 0.0% | 0.0% | 97.1% |
| action:done | 61 | 0.0% | 0.0% | 98.4% |
| action:select | 239 | 51.5% | 69.9% | 99.2% |
| action:skip | 676 | 73.7% | 73.7% | 98.2% |
| action:type | 436 | 78.4% | 85.6% | 99.3% |
| action:upload | 84 | 35.7% | 35.7% | 100.0% |
| free_text | 14 | 0.0% | 7.1% | 100.0% |

Trained (1 epoch, 1 h 23 min) and predicted on Colab GPU via `ml/colab.ipynb` (5.07 s/example incl. CoT text), rescored locally with `--preds`.

## lora-cot-v2 · test · 2026-10-20 · commit `6a6212f`

Model `HuggingFaceTB/SmolVLM-256M-Instruct` + adapter `checkpoints/lora-cot-v2`, format `with_cot`, prefill, longest_edge 1024, n=1544, data `data/dataset_v2`.

| subset | n | action acc | action-type acc | valid JSON |
|---|---:|---:|---:|---:|
| overall | 1530 | 66.0% | 71.5% | 99.3% |
| unambiguous | 729 | 63.9% | 69.8% | 99.3% |
| ambiguous | 801 | 67.9% | 73.0% | 99.3% |
| greenhouse | 730 | 55.3% | 63.0% | 98.9% |
| lever | 800 | 75.8% | 79.2% | 99.6% |
| action:click | 30 | 6.7% | 6.7% | 100.0% |
| action:done | 61 | 1.6% | 1.6% | 96.7% |
| action:select | 236 | 54.7% | 72.5% | 98.7% |
| action:skip | 686 | 74.3% | 74.3% | 99.4% |
| action:type | 436 | 76.4% | 86.0% | 99.5% |
| action:upload | 81 | 43.2% | 43.2% | 100.0% |
| free_text | 14 | 7.1% | 7.1% | 100.0% |

Trained (1 epoch) and predicted on Colab GPU via `ml/colab.ipynb` from the dataset v2 bundle (Colab run name `lora-co-v2`), rescored locally with `--preds`.

## always-skip-v2 · test · 2026-10-20 · commit `6a6212f-dirty`

Model `always-skip`, format `no_cot`, longest_edge 1024, n=1544, 0.00 s/example, data `data/dataset_v2`.

| subset | n | action acc | action-type acc | valid JSON |
|---|---:|---:|---:|---:|
| overall | 1530 | 44.8% | 44.8% | 100.0% |
| unambiguous | 729 | 23.7% | 23.7% | 100.0% |
| ambiguous | 801 | 64.0% | 64.0% | 100.0% |
| greenhouse | 730 | 35.1% | 35.1% | 100.0% |
| lever | 800 | 53.8% | 53.8% | 100.0% |
| action:click | 30 | 0.0% | 0.0% | 100.0% |
| action:done | 61 | 0.0% | 0.0% | 100.0% |
| action:select | 236 | 0.0% | 0.0% | 100.0% |
| action:skip | 686 | 100.0% | 100.0% | 100.0% |
| action:type | 436 | 0.0% | 0.0% | 100.0% |
| action:upload | 81 | 0.0% | 0.0% | 100.0% |
| free_text | 14 | 0.0% | 0.0% | 100.0% |
