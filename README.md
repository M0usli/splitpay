# SplitPay

[![CI](https://github.com/M0usli/receipt-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/M0usli/receipt-tracker/actions/workflows/ci.yml)

A wallet app for sending money and splitting bills. It holds a balance of
pretend money you can send to other people, turns a photo of a receipt into
a tracked expense, and splits shared costs between roommates. Upload a receipt, the app reads it with OCR,
an LLM pulls out the merchant, date, totals and every item, you check the
result, and it is saved to a searchable list with a spending dashboard. A
grocery receipt can be split item by item: tick who each item is for and the
app works out what everyone owes, tax included.

It runs on your own computer with Docker. See [Hosting](#hosting) for why
there is no live link, and [docs/DEMO.md](docs/DEMO.md) for a walk-through.

## Screenshots

<!--
Add four screenshots to docs/screenshots/ with these file names, then delete
this comment block's opening and closing lines so the images show.

| Upload | Review |
|---|---|
| ![Upload page](docs/screenshots/upload.png) | ![Review page](docs/screenshots/review.png) |

| Expenses | Dashboard |
|---|---|
| ![Expenses page](docs/screenshots/expenses.png) | ![Dashboard page](docs/screenshots/dashboard.png) |
-->

_Screenshots to add: `docs/screenshots/upload.png`, `review.png`, `expenses.png`, `dashboard.png`._

## What it does

- **Upload** a JPG, PNG or PDF receipt by drag and drop.
- **OCR** reads the text. The image is cleaned first (grayscale, resize,
  denoise, threshold, deskew) so photos taken at an angle or in poor light
  still read well.
- **An LLM extracts the fields**: merchant, date, subtotal, tax, total,
  currency and a category. Its reply must match a fixed schema and is
  validated before anything is stored.
- **Review** the extracted fields beside the receipt image, fix anything
  that is wrong, and save. The app flags totals that do not add up.
- **Expenses** list with month and category filters, edit, delete and CSV export.
- **Dashboard** with this month's total, spending by category, a six-month
  trend and top merchants.
- **Evaluation script** that measures extraction accuracy on a labelled set
  of receipts, with and without image preprocessing.

Added in version 2:

- **Accounts.** Sign up and log in; each person sees only their own
  receipts and expenses.
- **Households and split bills.** Roommates join a household with an invite
  code. An expense can be shared equally, by percent, by amount, or item by
  item from a receipt. The Split bill page shows who owes whom and records
  pay-backs.
- **Recurring costs** such as rent, added to the expenses every month.
- **Phone use.** The pages fit a phone, the upload page can open the camera,
  and the site can be added to the home screen.
- **Bank import (sandbox).** Connect a pretend bank through Plaid's sandbox
  and turn its transactions into expenses after reviewing them.

Added in version 3 (in progress):

- **Wallet.** Every user has a balance of pretend money. Add money, send it
  to another user with a confirm step, and see the history of money in and
  out. The page is button-first: a number pad, one-tap amounts and people.
- **Request money.** Ask another user for an amount. They see it on their
  Wallet page with Pay and Decline buttons; the person who asked can cancel
  it while it is waiting.
- **Pay what you owe in one tap.** The Wallet and Split bill pages show the
  exact amount owed to each housemate on a button that pays it from the
  wallet.

## How it works

```mermaid
flowchart LR
    user(["Browser"])

    subgraph compose["Docker Compose"]
        frontend["Frontend<br/>Next.js, React, TypeScript<br/>port 3000"]
        backend["Backend<br/>FastAPI, Pydantic, SQLAlchemy<br/>port 8000"]
        ocr["OCR<br/>OpenCV clean-up, Tesseract"]
        db[("PostgreSQL<br/>receipts, expenses")]
        files[("Uploads volume<br/>receipt files")]
    end

    claude["Anthropic API<br/>Claude"]

    user -- "loads pages" --> frontend
    user -- "REST / JSON" --> backend
    backend --> ocr
    backend -- "OCR text in, JSON fields out" --> claude
    backend --> db
    backend --> files
```

What happens when a receipt is uploaded:

1. The browser sends the file to `POST /receipts`.
2. The backend checks the file's real type and size, saves it under a random
   name, and creates a `Receipt` row with status `pending`.
3. OpenCV cleans the image and Tesseract reads the text.
4. The text goes to Claude with a prompt and a JSON schema. The reply is
   validated with Pydantic. If it is invalid the backend asks once more, then
   marks the receipt `failed` with a readable message.
5. A sanity check compares subtotal + tax with the total (within $0.02) and
   adds a warning if they disagree.
6. The Review page shows the receipt and the fields. Saving creates an
   `Expense` and records whether the user changed what the AI read.

## Tech stack

| Part | Tools |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript (strict), Tailwind CSS, Recharts |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic |
| Database | PostgreSQL 17 |
| OCR | Tesseract (pytesseract) with OpenCV preprocessing, behind a small interface |
| LLM | Anthropic Python SDK, structured JSON output |
| Tests | pytest, Vitest, React Testing Library |
| Tooling | Docker Compose, GitHub Actions, ruff, ESLint, openapi-typescript |

## Run it

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and
an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/YOUR-USERNAME/receipt-tracker.git
cd receipt-tracker

# Create your local settings file, then paste your API key into it.
cp .env.example .env

docker compose up
```

| What | Address |
|---|---|
| The app | http://localhost:3000 |
| API documentation (interactive) | http://localhost:8000/docs |
| Health check | http://localhost:8000/health |

The first start takes a few minutes while Docker builds the images. Database
migrations run automatically. Without an API key everything still works except
the AI extraction: receipts are saved and you can type the details by hand.

### Use it on your phone

The pages fit a phone screen, the upload page has a "Take a photo of a
receipt" button that opens the camera, and the site can be added to the home
screen. To reach it from a phone on the same Wi-Fi:

1. Find this computer's network address: run `ipconfig` and look for the
   IPv4 address, for example `192.168.1.20`.
2. In `.env`, set `PHONE_ORIGIN=http://192.168.1.20:3000` (your address).
3. Run `docker compose up -d` so both services pick it up.
4. On the phone, open `http://192.168.1.20:3000`.

If the page does not load, Windows Firewall is probably blocking ports 3000
and 8000 for other devices. The app is only reachable inside your own
network, over plain HTTP, so use it on a network you trust.

### Connect a sandbox bank

The Bank page imports transactions from a bank and lets you turn them into
expenses. It uses [Plaid](https://plaid.com)'s **sandbox**: pretend banks
with pretend transactions. The app cannot be pointed at real accounts.

1. Sign up for a free account at https://dashboard.plaid.com.
2. Open Developers > Keys and copy the client id and the *Sandbox* secret.
3. In `.env`, set `PLAID_CLIENT_ID` and `PLAID_SECRET`.
4. Run `docker compose up -d`, open the Bank page and choose "Connect a
   sandbox bank". In Plaid's window pick any bank and sign in with
   `user_good` / `pass_good`.
5. Choose "Import transactions". A bank that was just connected can need a
   few seconds before its transactions are ready.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/receipts` | Upload a file, run OCR and extraction |
| GET | `/receipts/{id}` | A receipt with its extracted fields, item lines and warnings |
| POST | `/receipts/{id}/extract` | Run the extraction again on the stored OCR text |
| GET | `/receipts/{id}/image` | The receipt image (`?processed=true` for the cleaned version) |
| POST | `/expenses` | Create an expense |
| GET | `/expenses` | List expenses, filter with `?month=YYYY-MM&category=` |
| GET, PUT, DELETE | `/expenses/{id}` | Read, change or delete one expense |
| GET | `/expenses/export.csv` | Download the filtered expenses as CSV |
| GET | `/stats/summary` | Totals for the dashboard |
| POST | `/auth/register` | Create an account and log it in |
| POST | `/auth/login` | Log in; the session token comes back in an HttpOnly cookie |
| POST | `/auth/logout` | End the current session |
| GET | `/auth/me` | The logged-in user, or 401 |
| POST | `/household` | Create a household and get its invite code |
| GET | `/household` | The logged-in user's household and its members |
| POST | `/household/join` | Join a household with an invite code |
| POST | `/household/leave` | Leave the household |
| GET | `/household/expenses` | The household's shared expenses, with who paid and each person's part |
| GET | `/household/balance` | Each member's position and the payments that settle it, `?currency=` |
| POST | `/household/split-preview` | What each member would pay for a receipt split item by item (saves nothing) |
| POST | `/household/pay` | Pay a member from the wallet: moves the money and settles the debt together |
| POST | `/household/settlements` | Record a pay-back made outside the app |
| GET | `/household/settlements` | The household's recorded payments |
| DELETE | `/household/settlements/{id}` | Undo a payment (only the person who recorded it) |
| POST, GET | `/recurring` | Create or list monthly recurring costs |
| PUT, DELETE | `/recurring/{id}` | Change, stop or delete a recurring cost |
| POST | `/recurring/run` | Make the monthly expenses that are due (safe to call again) |
| GET | `/bank/status` | Whether the sandbox keys are set, and the connected banks |
| POST | `/bank/link-token` | A token that opens Plaid's "choose your bank" window |
| POST, DELETE | `/bank/connections`, `/bank/connections/{id}` | Connect or remove a bank |
| POST | `/bank/sync` | Import new transactions (safe to call again) |
| GET | `/bank/transactions` | Imported transactions waiting for review |
| POST | `/bank/transactions/{id}/add`, `.../ignore` | Make an expense from one, or hide it |
| GET | `/wallet` | The logged-in user's wallet balance (pretend money) |
| POST | `/wallet/top-up` | Add pretend money to the wallet |
| POST | `/wallet/send` | Send money to another user by email |
| GET | `/wallet/transactions` | Money in and out, newest first |
| POST | `/wallet/requests` | Ask another user for money; nothing moves yet |
| GET | `/wallet/requests` | Requests the user made or received, newest first |
| POST | `/wallet/requests/{id}/pay` | Pay a request from the wallet (only the person asked) |
| POST | `/wallet/requests/{id}/decline` | Say no to a request (only the person asked) |
| POST | `/wallet/requests/{id}/cancel` | Take a request back (only the person who asked) |

Every `/receipts`, `/expenses` and `/stats` endpoint needs a login and works
only on the logged-in user's own rows.

The frontend's TypeScript types are generated from the backend's OpenAPI
schema (`npm run generate:api`), so the two sides cannot drift apart silently.

## Tests and checks

```bash
# Backend: lint, formatting, tests
docker compose exec backend ruff check .
docker compose exec backend ruff format --check .
docker compose exec backend pytest

# Frontend: lint, type check, tests
docker compose exec frontend npm run lint
docker compose exec frontend npm run typecheck
docker compose exec frontend npm test
```

The backend tests run against a separate PostgreSQL database. OCR and the LLM
are replaced by fakes, so the tests are fast, free and need no API key.
GitHub Actions runs all of the above on every push
([workflow](.github/workflows/ci.yml)).

## Evaluation

`python -m app.eval` runs the full pipeline on a folder of labelled receipts
and reports accuracy per field. Dates, tax and totals must match exactly;
merchant names use a fuzzy match. A receipt the pipeline cannot process counts
as wrong for every field. See [eval/README.md](eval/README.md) for the label
format.

```bash
# Try it on the five made-up sample receipts in the repository
docker compose exec backend python -m app.eval --dir /eval/sample

# Run it on your own labelled receipts in eval/receipts/
docker compose exec backend python -m app.eval
```

### Results

<!--
Fill this in from the summary table that `python -m app.eval` prints for YOUR
receipts in eval/receipts/. Do not use the numbers from the sample set: those
five receipts are synthetic and too easy.
-->

Evaluated on **__ receipts** (my own photos, hand-labelled) with model
`claude-haiku-5-5` on **YYYY-MM-DD**.

| Field | With preprocessing | Without preprocessing |
|---|---|---|
| Merchant (fuzzy match) | __ % | __ % |
| Date (exact) | __ % | __ % |
| Tax (exact) | __ % | __ % |
| Total (exact) | __ % | __ % |
| Category | __ % | __ % |
| All fields correct | __ % | __ % |
| Average time per receipt | __ s | __ s |

_What the numbers show, in a sentence or two: to be written._

## Project structure

```
receipt-tracker/
├── compose.yaml            three services: postgres, backend, frontend
├── .env.example            settings template (copy to .env)
├── backend/
│   ├── app/
│   │   ├── main.py         creates the FastAPI app
│   │   ├── auth.py         password hashing, login sessions, current user
│   │   ├── splitting.py    the arithmetic for splitting shared expenses
│   │   ├── bank/           the bank-data interface and the Plaid sandbox client
│   │   ├── wallet.py       the ledger: moving pretend money between wallets
│   │   ├── routers/        the HTTP endpoints
│   │   ├── schemas/        Pydantic request and response shapes
│   │   ├── models/         SQLAlchemy database tables
│   │   ├── ocr/            image loading, preprocessing, Tesseract
│   │   ├── extraction/     prompt, Claude client, validation, sanity checks
│   │   └── eval/           the evaluation script
│   ├── alembic/            database migrations
│   └── tests/
├── frontend/
│   └── src/
│       ├── app/            pages (Wallet, Upload, Review, Expenses, Dashboard, Split bill, Recurring, Bank, Log in, Sign up)
│       ├── components/     React components and their tests
│       └── lib/            API client, generated types, formatting helpers
├── eval/                   test receipts, labels and results
└── .github/workflows/      CI
```

## Design decisions

- **Money is never a float.** Amounts are `NUMERIC` in PostgreSQL, `Decimal`
  in Python and strings in JSON, so cents are never lost to rounding.
- **The LLM's output is not trusted.** It must match a JSON schema, is
  validated again by Pydantic, gets one retry, and the model is told to
  return null instead of guessing. Receipt text is passed as data inside
  tags, so text printed on a receipt cannot act as instructions.
- **Item lines are read too, and checked.** Each line has a name, a
  quantity, a price (negative for a discount) and whether it was taxed, or
  null when the receipt does not say. The items are stored with the rest of
  the AI's answer, and the user is warned when they do not add up to the
  subtotal.
- **OCR and the LLM sit behind small interfaces.** Tests swap in fakes, and a
  different OCR engine or model provider would be a one-file change.
- **A failed receipt is still saved**, with a status and a message, so the
  user can retry or type the details in by hand.
- **`was_edited` is decided by the server**, by comparing what was saved with
  what the AI extracted. It shows how often the AI needed correcting.
- **Passwords and session tokens are stored only as hashes.** Passwords use
  Argon2. A login is a random token in an HttpOnly cookie, and the database
  keeps its SHA-256, so logging out really ends the session and a leaked
  database cannot be used to log in.
- **The browser cannot read the login.** The cookie is HttpOnly, so the
  frontend asks `GET /auth/me` who is signed in and shares the answer through
  a React context. Sending signed-out visitors to the log-in page is done in
  the browser for convenience only; the backend is what enforces access.
- **A split never loses a cent.** A shared expense stores each person's part
  as an exact amount, and the parts must add up to the total. With no parts
  given, the total is split equally among the household: everyone gets the
  amount rounded down to the cent, and the leftover cents go to the first
  people, starting with the payer.
- **Splits typed in the browser are worked out in whole cents.** A percent
  or equal split chosen on the form is turned into exact amounts with
  integer arithmetic (`frontend/src/lib/split.ts`), and the backend checks
  again that they add up to the total.
- **A receipt can be split item by item.** Each line is ticked for the people
  it is for and divided equally among them. Tax follows the taxed lines
  only, in proportion, so someone who bought only untaxed food pays no tax.
  The server works out the parts from the items; parts sent by the browser
  are ignored. The page shows a live summary from the same server code
  (`/household/split-preview`), so what you see is what gets saved.
- **The wallet is a ledger, and the money is pretend.** Every transfer takes
  an amount out of one wallet and puts it into another, so the total over
  all wallets is always zero; a top-up comes from an "outside world" wallet.
  Balances are added up from the transfers, never stored. A send locks the
  sender's wallet row while it checks the balance, so simultaneous sends
  cannot overspend, and each request carries an idempotency key so a double
  tap or a retry moves money once.
- **Paying a debt is one transaction.** Paying a housemate from the wallet
  writes the ledger transfer and the settlement in the same database
  transaction, so the money moves and the debt is cleared together or not at
  all. A wallet payment cannot be undone in the app, because the ledger is
  never rewritten.
- **A request can only be answered once.** A request starts as pending and
  ends as paid, declined or cancelled. The backend locks the request's row
  while it changes, so Pay tapped on two devices at the same moment moves
  the money once, and a finished request cannot change again.
- **Sending money takes two steps.** The Wallet page shows the amount and
  the recipient back for confirmation before anything moves. The request id
  (idempotency key) is made when that confirm step opens, so pressing
  Confirm twice sends the same id and the money moves once.
- **The bank connection is sandbox only, by construction.** The Plaid
  address is a constant in the code and there is no setting to change it.
  The secret key and each bank's access token stay on the backend; the
  browser only ever handles short-lived, one-time tokens. Plaid sits behind
  the same kind of small interface as OCR and the LLM, so tests use a fake.
- **Imported transactions are reviewed, not trusted.** They wait in a list
  until the user adds or ignores each one. Plaid's id for a transaction is
  unique in the database, so importing twice cannot duplicate it.
- **Recurring costs cannot be made twice.** Each monthly expense records the
  recurring cost and the month it is for, and the database has a unique rule
  on that pair. The run that makes them can be called any number of times,
  even at the same moment, and each month still gets one expense. There is
  no background scheduler: the app calls the run when it opens and catches
  up on any months it missed.
- **Paying someone back is not an expense.** A settlement only moves the
  balance, and only the person who paid can record or undo it.
- **The balance is netted.** Each member's position is what they are owed
  minus what they owe. The suggested payments match the biggest debtor with
  the biggest creditor until everyone is at zero, so N people need at most
  N - 1 payments.
- **Each user sees only their own data.** Receipts and expenses carry a
  `user_id` taken from the login session, never from the request, and every
  query filters on it. Asking for someone else's row gives the same 404 as a
  row that does not exist.
- **Secrets stay out of the repository.** The API key and model name come
  from environment variables; `.env` is gitignored.

## Hosting

This project is not hosted, on purpose. The goal was hosting at no cost, and
a free setup is possible (a static-friendly frontend host, a free container
host for the backend and a free Postgres), but it fits this app badly:

- **OCR needs a real server.** The backend runs Tesseract and OpenCV in a
  Docker container. Free container hosts give it little memory and put it to
  sleep when idle, so the first request after a pause can take up to a
  minute.
- **Uploaded receipts would be lost.** Free containers have no permanent
  disk. Keeping the receipt images would need a separate storage service.
- **A public site spends the owner's AI credit.** Every scan calls a paid
  API. Anyone who signed up could run up the bill, so a public deployment
  first needs sign-up to be closed or limited.
- **Logins need more work across two sites.** The session cookie is only
  sent to the same site. With the frontend and backend on different hosts,
  the frontend has to forward API calls so both appear as one site.
- **Receipts are personal.** They carry card digits and addresses.

None of these is a blocker, and the work to become deploy-ready is tracked
in [issue #22](https://github.com/M0usli/receipt-tracker/issues/22). Until
then, [docs/DEMO.md](docs/DEMO.md) shows what the
app does.

## Known limitations

- A household's balance stops counting someone who leaves it.
- Recurring costs are made when the app is opened, not by a scheduler.
- The bank connection is sandbox only, and its imports are in US dollars.
- Item reading depends on OCR quality; a crumpled receipt needs corrections.
- Saving the same receipt twice creates two expenses.
- The dashboard totals one currency at a time (CAD by default).
- OCR is set up for English, and HEIC photos must be converted to JPG first.
- The Docker setup is for development (hot reload), not a production deployment.
