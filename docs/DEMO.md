# Demo walk-through

The app is not hosted (the README explains why), so this page is the script
for showing it: a two-minute screen recording and four screenshots.

## Before recording

1. Start the app: `docker compose up`, then open http://localhost:3000.
2. Use made-up data only. Receipts show card digits and addresses, so record
   with the sample receipts in `eval/sample/receipts/`, not your own.
3. Create two accounts in two browser windows (one of them private), for
   example `sam@example.com` and `alex@example.com`. Use them only for the
   demo.
4. Check the API key is set in `.env`. Each scan in the demo makes one call.
5. Set the browser zoom so the page fills the recording without scrolling
   sideways.

## The two-minute recording

| Time | Show | Say |
|---|---|---|
| 0:00 | The Upload page | "This turns a photo of a receipt into a tracked expense." |
| 0:10 | Drop in `sample-01-freshco.jpg` | "OCR reads the text, then an LLM extracts the fields into a fixed schema." |
| 0:25 | The Review page: image, fields, item list | "It reads every item, and checks that the items add up to the subtotal." |
| 0:40 | Split bill page as Sam: create a household, copy the code | "Roommates form a household with an invite code." |
| 0:50 | Second window as Alex: join with the code | |
| 1:00 | Back on the Review page: tick Share, untick people per item | "Tick who each item is for. Tax follows the taxed items only." |
| 1:20 | The "Who pays what" summary, then Save | "The server works out the split, so the parts always add up to the total." |
| 1:30 | Alex's Split bill page: "You owe ...", press "I paid this" | "Paying back is recorded separately from spending." |
| 1:45 | Dashboard | "And everything lands in the spending dashboard." |
| 1:55 | The pull request list on GitHub | "Each feature went through an issue, a branch, a pull request and CI." |

Optional extras if there is time: the Recurring page (add a cost due today
and watch the expense appear), the phone layout (narrow the browser window),
and the Bank page.

## The four screenshots

Save them in `docs/screenshots/` with these names. The README has a
commented-out table that shows them once the files exist.

| File | Page | What should be visible |
|---|---|---|
| `upload.png` | Upload | The drop area |
| `review.png` | Review, with the item split open | The receipt image, the items with tick boxes, "Who pays what" |
| `expenses.png` | Expenses | A few expenses, the filters |
| `dashboard.png` | Dashboard | The month total and both charts |

## After recording

- Delete the two demo accounts if you do not want them in your database.
- Put the video somewhere linkable (an unlisted upload works) and add the
  link at the top of the README.
