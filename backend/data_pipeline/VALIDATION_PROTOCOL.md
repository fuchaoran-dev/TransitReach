# Manual stop-arrival validation protocol

The file `data/validation/manual_arrivals_2025_04.csv` contains 450 stratified tasks:
150 each for U1510, U2020 and U6000. Vehicle identifiers are hashed.

For every task, inspect the raw trajectory around the stop without treating
`reference_arrival` as ground truth. Record the first defensible stop arrival in ISO 8601
Malaysia time under `annotated_actual_arrival`, an annotator identifier, confidence
(`high`, `medium`, `low`), the surrounding GPS gap, and notes. Use `exclude_reason` for
`false_match`, `insufficient_gps`, `wrong_trip`, or `ambiguous`. A second reviewer must
resolve disagreements above 60 seconds.

Run:

```bash
.venv/bin/python -m backend.data_pipeline.evaluate_arrival_validation \
  --input data/validation/manual_arrivals_2025_04.csv \
  --output backend/data_pipeline/reports/arrival_validation_2025_04.json
```

Promotion requires at least 300 reviewed records, arrival MAE no more than 90 seconds,
at least 90% within 120 seconds, and a false-match rate no more than 2%. These provisional
thresholds are explicit and may be revised only with a documented review.
