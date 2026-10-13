"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import AmountPad from "@/components/AmountPad";
import StepHeader from "@/components/StepHeader";
import {
  getWallet,
  listBillers,
  listBillPayments,
  listSavedBillers,
  payBill,
  removeSavedBiller,
  saveBiller,
  type Biller,
  type BillPayment,
  type SavedBiller,
  type Wallet,
} from "@/lib/api";
import { finishAmount, isPositiveAmount } from "@/lib/amountInput";
import { formatMoney } from "@/lib/format";
import { newRequestId } from "@/lib/requestId";

type BillsData = {
  wallet: Wallet;
  billers: Biller[];
  saved: SavedBiller[];
  payments: BillPayment[];
};

type Status =
  | { state: "loading" }
  | { state: "loaded"; data: BillsData }
  | { state: "error"; message: string };

/** Which screen of the page is showing. */
type View =
  | { name: "home" }
  // Adding a biller: pick the company, then type the account number.
  | { name: "add-pick" }
  | { name: "add-account"; biller: Biller }
  // Paying: how much, then confirm.
  | { name: "pay-amount"; saved: SavedBiller }
  // The request id is made when this step opens and reused if Confirm is tapped twice.
  | { name: "pay-confirm"; saved: SavedBiller; amount: string; requestId: string }
  | { name: "receipt"; payment: BillPayment; isNew: boolean };

const BILL_AMOUNTS = ["25", "50", "75", "100"];

const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const primaryButtonClass =
  "w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white " +
  "hover:bg-indigo-500 disabled:bg-zinc-300";
const dashedButtonClass =
  "w-full rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium " +
  "text-zinc-700 hover:border-indigo-400";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

async function loadBillsData(): Promise<BillsData> {
  const [wallet, billers, saved, payments] = await Promise.all([
    getWallet(),
    listBillers(),
    listSavedBillers(),
    listBillPayments(),
  ]);
  return { wallet, billers, saved, payments };
}

/** A coloured square with the company's first letter. */
function BillerIcon({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 font-semibold text-indigo-700"
    >
      {name[0]}
    </span>
  );
}

/** One line of a receipt: a label on the left and its value on the right. */
function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** The Bills page: saved billers, paying a bill from the wallet, and receipts. */
export default function Bills() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [view, setView] = useState<View>({ name: "home" });
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // What is being entered in the current step.
  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  useEffect(() => {
    let isCurrent = true;
    loadBillsData()
      .then((data) => {
        if (isCurrent) {
          setStatus({ state: "loaded", data });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setStatus({ state: "error", message: errorMessage(error) });
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  /** Open a screen with its inputs empty and old messages cleared. */
  function open(next: View) {
    setAmount("");
    setAccountNumber("");
    setActionError(null);
    if (next.name !== "home") {
      setNotice(null);
    }
    setView(next);
  }

  /** Run a change, load everything again, then open the screen the change asks for. */
  async function run(action: () => Promise<{ next: View; message: string | null }>) {
    setIsBusy(true);
    setActionError(null);
    try {
      const { next, message } = await action();
      setStatus({ state: "loaded", data: await loadBillsData() });
      open(next);
      setNotice(message);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleSave(event: FormEvent<HTMLFormElement>, biller: Biller) {
    event.preventDefault();
    void run(async () => {
      await saveBiller(biller.code, accountNumber);
      return { next: { name: "home" }, message: `${biller.name} was saved.` };
    });
  }

  function handleRemove(saved: SavedBiller) {
    void run(async () => {
      await removeSavedBiller(saved.id);
      return { next: { name: "home" }, message: `${saved.biller.name} was removed.` };
    });
  }

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  const { wallet, billers, saved, payments } = status.data;

  const alert = actionError !== null && (
    <div role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>{actionError}</p>
      {actionError.includes("enough money") && (
        <Link href="/" className="font-medium underline">
          Add money to your wallet
        </Link>
      )}
    </div>
  );

  if (view.name === "add-pick") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Add a biller">
        <StepHeader title="Which company?" onBack={() => open({ name: "home" })} />
        <ul className="space-y-2">
          {billers.map((biller) => (
            <li key={biller.code}>
              <button
                type="button"
                onClick={() => open({ name: "add-account", biller })}
                className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 p-3 text-left hover:border-indigo-400"
              >
                <BillerIcon name={biller.name} />
                <span>
                  <span className="block text-sm font-medium">{biller.name}</span>
                  <span className="block text-xs text-zinc-500">{biller.kind}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (view.name === "add-account") {
    const { biller } = view;
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Add a biller">
        <StepHeader title="Your account number" onBack={() => open({ name: "add-pick" })} />
        {alert}
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
          <BillerIcon name={biller.name} />
          <p className="text-sm">
            <strong>{biller.name}</strong> · {biller.kind}
          </p>
        </div>
        <form onSubmit={(event) => handleSave(event, biller)}>
          <label htmlFor="account-number" className="block text-sm font-medium text-zinc-700">
            Account number
          </label>
          <input
            id="account-number"
            required
            autoFocus
            autoComplete="off"
            minLength={4}
            maxLength={20}
            // The same rule the backend checks: letters, digits and dashes.
            pattern="[A-Za-z0-9\-]+"
            title="4 to 20 letters, digits or dashes"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm uppercase focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-zinc-500">
            The companies are made up, so any number works, for example AB-1234.
          </p>
          <button type="submit" disabled={isBusy} className={`${primaryButtonClass} mt-4`}>
            Save biller
          </button>
        </form>
      </section>
    );
  }

  if (view.name === "pay-amount") {
    const target = view.saved;
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Pay a bill">
        <StepHeader title="How much is the bill?" onBack={() => open({ name: "home" })} />
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
          <BillerIcon name={target.biller.name} />
          <p className="min-w-0 truncate text-sm">
            <strong>{target.biller.name}</strong> · {target.account_number}
          </p>
        </div>
        <AmountPad value={amount} onChange={setAmount} quickAmounts={BILL_AMOUNTS} label="Amount to pay" />
        <p className="mt-3 text-center text-xs text-zinc-500">
          In your wallet: {formatMoney(wallet.balance, wallet.currency)}
        </p>
        <button
          type="button"
          disabled={!isPositiveAmount(amount)}
          onClick={() =>
            setView({
              name: "pay-confirm",
              saved: target,
              amount: finishAmount(amount),
              requestId: newRequestId(),
            })
          }
          className={`${primaryButtonClass} mt-4`}
        >
          Review
        </button>
      </section>
    );
  }

  if (view.name === "pay-confirm") {
    const bill = view;
    return (
      <section className={`${cardClass} mx-auto max-w-md text-center`} aria-label="Confirm">
        <StepHeader
          title="Check and confirm"
          onBack={() => {
            // The amount typed so far is kept; the old error is not.
            setActionError(null);
            setView({ name: "pay-amount", saved: bill.saved });
          }}
        />
        {alert}
        <p className="text-sm text-zinc-600">You are paying</p>
        <p className="text-4xl font-semibold tracking-tight">
          {formatMoney(bill.amount, wallet.currency)}
        </p>
        <p className="mt-1 text-sm">
          to <strong>{bill.saved.biller.name}</strong>
        </p>
        <p className="text-sm text-zinc-600">Account {bill.saved.account_number}</p>
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            void run(async () => {
              const payment = await payBill(bill.saved.id, bill.amount, bill.requestId);
              return { next: { name: "receipt", payment, isNew: true }, message: null };
            })
          }
          className={`${primaryButtonClass} mt-6`}
        >
          {isBusy ? "Paying…" : "Confirm and pay"}
        </button>
      </section>
    );
  }

  if (view.name === "receipt") {
    const { payment, isNew } = view;
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Receipt">
        {isNew ? (
          <p role="status" className="mb-2 text-center text-lg font-semibold text-green-700">
            ✓ Bill paid
          </p>
        ) : (
          <StepHeader title="Receipt" onBack={() => open({ name: "home" })} />
        )}
        <p className="text-center text-4xl font-semibold tracking-tight">
          {formatMoney(payment.amount, payment.currency)}
        </p>
        {/* dl is the HTML list for label and value pairs. */}
        <dl className="mt-4 divide-y divide-zinc-100">
          <ReceiptLine label="Paid to" value={payment.biller.name} />
          <ReceiptLine label="For" value={payment.biller.kind} />
          <ReceiptLine label="Account" value={payment.account_number} />
          <ReceiptLine label="Date" value={payment.created_at.slice(0, 10)} />
          <ReceiptLine label="Reference" value={payment.reference} />
        </dl>
        <p className="mt-3 text-center text-xs text-zinc-500">
          Pretend money and a made-up company. No real bill was paid.
        </p>
        {isNew && (
          <button type="button" onClick={() => open({ name: "home" })} className={`${primaryButtonClass} mt-4`}>
            Done
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        In your wallet: <strong>{formatMoney(wallet.balance, wallet.currency)}</strong>
      </p>

      {notice !== null && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ {notice}
        </p>
      )}
      {alert}

      <section className={cardClass} aria-labelledby="billers-heading">
        <h2 id="billers-heading" className="text-sm font-semibold text-zinc-700">
          Your billers
        </h2>
        {saved.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No billers yet. Add your electricity, internet or phone company to pay it from here.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {saved.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <BillerIcon name={item.biller.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.biller.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {item.biller.kind} · {item.account_number}
                  </p>
                </div>
                {/* Two buttons do not fit beside the name on a phone, so they get their own row. */}
                <span className="flex w-full gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => open({ name: "pay-amount", saved: item })}
                    aria-label={`Pay ${item.biller.name} ${item.account_number}`}
                    className="flex-1 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-zinc-300"
                  >
                    Pay
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleRemove(item)}
                    aria-label={`Remove ${item.biller.name} ${item.account_number}`}
                    className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => open({ name: "add-pick" })} className={`${dashedButtonClass} mt-3`}>
          + Add a biller
        </button>
      </section>

      <section className={cardClass} aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="text-sm font-semibold text-zinc-700">
          Receipts
        </h2>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Bills you pay will be listed here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {payments.map((payment) => (
              <li key={payment.id}>
                <button
                  type="button"
                  onClick={() => open({ name: "receipt", payment, isNew: false })}
                  aria-label={`Receipt ${payment.reference}`}
                  className="flex w-full items-center gap-3 rounded-xl py-3 text-left hover:bg-zinc-50"
                >
                  <BillerIcon name={payment.biller.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{payment.biller.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {payment.created_at.slice(0, 10)} · {payment.reference}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold">
                    −{formatMoney(payment.amount, payment.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
