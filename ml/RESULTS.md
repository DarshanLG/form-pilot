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
