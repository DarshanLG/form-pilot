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
