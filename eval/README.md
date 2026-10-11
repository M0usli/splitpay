# Evaluation

Measures how often the pipeline (OCR, then AI extraction) reads a receipt correctly.

## Folder layout

```
eval/
  receipts/      your test receipts (JPG, PNG or PDF); not committed to git
  labels.csv     the correct answers, typed by hand
  results.csv    written by each run: one row per receipt and mode
  sample/        five made-up receipts with labels, for trying the script
```

## Steps

1. Put receipt photos in `eval/receipts/`.
2. Create the labels file with one empty row per photo:

   ```
   docker compose exec backend python -m app.eval --init-labels
   ```

3. Open `eval/labels.csv` and type the correct answers (rules below).
4. Run the evaluation:

   ```
   docker compose exec backend python -m app.eval
   ```

Each receipt is run twice, with and without image preprocessing, so the two
can be compared. Every run is one paid API call.

Options: `--mode preprocessed` or `--mode raw` runs one mode only, `--limit 5`
runs the first five receipts, and `--dir /eval/sample` uses the sample set.

## Label rules

| Column | Write | Example |
|---|---|---|
| `filename` | the file's name in `receipts/` | `IMG_2041.jpg` |
| `merchant` | the store's name | `Tim Hortons` |
| `date` | year-month-day | `2026-10-08` |
| `tax` | the tax amount, no `$` | `1.62` |
| `total` | the amount charged, no `$` | `38.47` |
| `category` | optional; one of the app's categories | `Groceries` |

- Leave a cell **empty** to skip that field for that receipt (it is not scored).
- Write **NONE** when the receipt does not print that field at all. The correct
  answer is then "not found", and a guess from the AI counts as wrong.
- If you edit the file in Excel, check the dates afterwards: Excel likes to
  rewrite `2026-10-08` as `10/8/2026`, which the script rejects.

## How answers are scored

- **Date, tax, total, category:** must match exactly.
- **Merchant:** a fuzzy match. Both names are lowercased, punctuation is
  removed, and they must be at least 80% similar (`difflib.SequenceMatcher`).
- A receipt the pipeline could not process counts as wrong for every labelled field.
- Accuracy for a field = correct answers / receipts that have a label for it.
