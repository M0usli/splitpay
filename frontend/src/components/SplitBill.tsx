"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/AuthProvider";
import {
  createHousehold,
  deleteSettlement,
  getBalance,
  getHousehold,
  joinHousehold,
  leaveHousehold,
  listSettlements,
  listSharedExpenses,
  payFromWallet,
  recordSettlement,
  type Balance,
  type Household,
  type Member,
  type Settlement,
  type SharedExpense,
} from "@/lib/api";
import PinPrompt from "@/components/PinPrompt";
import { formatMoney } from "@/lib/format";
import { helpLinkFor } from "@/lib/helpLink";
import { RequestIds } from "@/lib/requestId";

type HouseholdData = {
  household: Household;
  balance: Balance;
  expenses: SharedExpense[];
  settlements: Settlement[];
};

type Status =
  | { state: "loading" }
  | { state: "none" }
  | { state: "loaded"; data: HouseholdData }
  | { state: "error"; message: string };

const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";
const labelClass = "block text-sm font-medium text-zinc-700";
const buttonClass =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50";
const cardClass = "rounded-lg border border-zinc-200 bg-white p-5";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Load everything the page shows. The four requests run at the same time. */
async function loadHouseholdData(): Promise<HouseholdData | null> {
  const household = await getHousehold();
  if (household === null) {
    return null;
  }
  const [balance, expenses, settlements] = await Promise.all([
    getBalance(),
    listSharedExpenses(),
    listSettlements(),
  ]);
  return { household, balance, expenses, settlements };
}

function toStatus(data: HouseholdData | null): Status {
  return data === null ? { state: "none" } : { state: "loaded", data };
}

/** The Split bill page: join or create a household, then see who owes whom. */
export default function SplitBill() {
  const { auth } = useAuth();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Set while the PIN is being asked for a payment from the wallet.
  const [paying, setPaying] = useState<{ to: Member; amount: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // useRef keeps the same object for as long as the page is open, so a
  // second tap on a Pay button finds the id the first tap made.
  const payIds = useRef(new RequestIds());

  // Load the page's data once, when the page opens.
  useEffect(() => {
    let isCurrent = true;
    loadHouseholdData()
      .then((data) => {
        if (isCurrent) {
          setStatus(toStatus(data));
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

  /** Run a change (join, pay, leave...), then load the page's data again. */
  async function run(action: () => Promise<unknown>) {
    setIsBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      setStatus(toStatus(await loadHouseholdData()));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  if (status.state === "loading" || auth.state !== "signedIn") {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  // "Not enough money" and "verify your identity" each have a page that fixes them.
  const helpLink = helpLinkFor(actionError);
  const alert = actionError !== null && (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {actionError}
    </p>
  );

  if (status.state === "none") {
    return (
      <div className="space-y-6">
        {alert}
        <NoHousehold
          isBusy={isBusy}
          onCreate={(name) => run(() => createHousehold(name))}
          onJoin={(code) => run(() => joinHousehold(code))}
        />
      </div>
    );
  }

  const { household, balance, expenses, settlements } = status.data;
  const myId = auth.user.id;
  const nameOf = (member: Member) => (member.id === myId ? "You" : member.email);
  const myNet = balance.members.find((entry) => entry.member.id === myId)?.net ?? "0.00";

  /** Pay a housemate from the wallet: the money moves and the debt is settled together. */
  async function payWithPin(pin: string) {
    if (paying === null) {
      return;
    }
    const { to, amount } = paying;
    const action = `pay-${to.id}-${amount}`;
    await run(async () => {
      await payFromWallet(to.id, amount, payIds.current.idFor(action), pin);
      payIds.current.forget(action);
      setPaying(null);
      setNotice(`You paid ${to.email} ${formatMoney(amount, "CAD")} from your wallet.`);
    });
  }

  function handleLeave() {
    const confirmed = window.confirm(
      "Leave this household? What you owe or are owed here will no longer be counted.",
    );
    if (confirmed) {
      void run(() => leaveHousehold());
    }
  }

  if (paying !== null) {
    return (
      <PinPrompt
        what={`Pay ${paying.to.email} ${formatMoney(paying.amount, "CAD")} from your wallet`}
        error={actionError}
        isBusy={isBusy}
        onBack={() => {
          setActionError(null);
          setPaying(null);
        }}
        onSubmit={payWithPin}
      />
    );
  }

  return (
    <div className="space-y-6">
      {alert}
      {helpLink !== null && (
        <p className="text-sm">
          <Link href={helpLink.href} className="font-medium underline">
            {helpLink.label}
          </Link>
        </p>
      )}
      {notice !== null && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}

      <section className={cardClass} aria-labelledby="household-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="household-heading" className="text-lg font-semibold">
              {household.name}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Invite code:{" "}
              <span className="font-mono font-semibold tracking-wider text-zinc-900">
                {household.invite_code}
              </span>
            </p>
            <p className="text-xs text-zinc-500">Give this code to a roommate so they can join.</p>
          </div>
          <button type="button" onClick={handleLeave} disabled={isBusy} className={smallButtonClass}>
            Leave household
          </button>
        </div>
        <ul className="mt-4 divide-y divide-zinc-100 text-sm">
          {balance.members.map(({ member, net }) => (
            <li key={member.id} className="flex items-center justify-between py-2">
              <span>{member.id === myId ? `You (${member.email})` : member.email}</span>
              <span className="text-zinc-600">{describeNet(net, balance.currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={cardClass} aria-labelledby="balance-heading">
        <h2 id="balance-heading" className="text-lg font-semibold">
          Balance
        </h2>
        <p className="mt-1 text-sm text-zinc-600">{describeMine(myNet, balance.currency)}</p>

        {balance.payments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Everyone is settled up.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {balance.payments.map((payment) => (
              <li
                key={`${payment.owed_by.id}-${payment.owed_to.id}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {nameOf(payment.owed_by)} {payment.owed_by.id === myId ? "pay" : "pays"}{" "}
                  {nameOf(payment.owed_to).replace("You", "you")}{" "}
                  <strong>{formatMoney(payment.amount, balance.currency)}</strong>
                </span>
                {payment.owed_by.id === myId && (
                  <span className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setActionError(null);
                        setNotice(null);
                        setPaying({ to: payment.owed_to, amount: payment.amount });
                      }}
                      className={buttonClass}
                    >
                      Pay {formatMoney(payment.amount, balance.currency)} from wallet
                    </button>
                    {/* For money handed over outside the app, such as cash. Nothing moves in the wallet. */}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => run(() => recordSettlement(payment.owed_to.id, payment.amount))}
                      className={smallButtonClass}
                    >
                      I paid another way
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass} aria-labelledby="shared-heading">
        <h2 id="shared-heading" className="text-lg font-semibold">
          Shared expenses
        </h2>
        {expenses.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing shared yet. Tick “Share this expense with my household” when you add or edit
            an expense.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Merchant</th>
                  <th className="py-2 pr-4 font-medium">Paid by</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Your part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {expenses.map((expense) => {
                  const myShare = expense.shares.find((share) => share.user_id === myId);
                  return (
                    <tr key={expense.id}>
                      <td className="whitespace-nowrap py-2 pr-4">{expense.date}</td>
                      <td className="py-2 pr-4">{expense.merchant}</td>
                      <td className="py-2 pr-4">{nameOf(expense.paid_by)}</td>
                      <td className="py-2 pr-4 text-right">
                        {formatMoney(expense.total, expense.currency)}
                      </td>
                      <td className="py-2 text-right">
                        {formatMoney(myShare?.amount ?? "0", expense.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {settlements.length > 0 && (
        <section className={cardClass} aria-labelledby="payments-heading">
          <h2 id="payments-heading" className="text-lg font-semibold">
            Payments made
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {settlements.map((settlement) => (
              <li key={settlement.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {nameOf(settlement.paid_by)} paid {nameOf(settlement.paid_to).replace("You", "you")}{" "}
                  <strong>{formatMoney(settlement.amount, settlement.currency)}</strong>
                  <span className="text-zinc-500">
                    {" "}
                    on {settlement.created_at.slice(0, 10)}
                    {settlement.paid_from_wallet ? ", from wallet" : ""}
                  </span>
                </span>
                {/* A wallet payment really moved money, so it cannot be undone here. */}
                {settlement.paid_by.id === myId && !settlement.paid_from_wallet && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => run(() => deleteSettlement(settlement.id))}
                    className={smallButtonClass}
                  >
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** "is owed $50.00", "owes $50.00" or "settled", for the members list. */
function describeNet(net: string, currency: string): string {
  if (net.startsWith("-")) {
    return `owes ${formatMoney(net.slice(1), currency)}`;
  }
  return Number(net) === 0 ? "settled" : `is owed ${formatMoney(net, currency)}`;
}

function describeMine(net: string, currency: string): string {
  if (net.startsWith("-")) {
    return `You owe ${formatMoney(net.slice(1), currency)} in total.`;
  }
  return Number(net) === 0
    ? "You are settled up."
    : `You are owed ${formatMoney(net, currency)} in total.`;
}

type NoHouseholdProps = {
  isBusy: boolean;
  onCreate: (name: string) => void;
  onJoin: (inviteCode: string) => void;
};

/** Shown to a user who is not in a household yet: create one or join one. */
function NoHousehold({ isBusy, onCreate, onJoin }: NoHouseholdProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  function submit(event: FormEvent<HTMLFormElement>, action: () => void) {
    event.preventDefault();
    action();
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <form onSubmit={(event) => submit(event, () => onCreate(name))} className={cardClass}>
        <h2 className="text-lg font-semibold">Create a household</h2>
        <p className="mt-1 text-sm text-zinc-600">You get a code to give to your roommates.</p>
        <label htmlFor="household-name" className={`${labelClass} mt-4`}>
          Household name
        </label>
        <input
          id="household-name"
          type="text"
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
        <button type="submit" disabled={isBusy} className={`${buttonClass} mt-4`}>
          Create
        </button>
      </form>

      <form onSubmit={(event) => submit(event, () => onJoin(code))} className={cardClass}>
        <h2 className="text-lg font-semibold">Join a household</h2>
        <p className="mt-1 text-sm text-zinc-600">Type the code a roommate gave you.</p>
        <label htmlFor="invite-code" className={`${labelClass} mt-4`}>
          Invite code
        </label>
        <input
          id="invite-code"
          type="text"
          required
          maxLength={16}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className={`${inputClass} font-mono uppercase tracking-wider`}
        />
        <button type="submit" disabled={isBusy} className={`${buttonClass} mt-4`}>
          Join
        </button>
      </form>
    </div>
  );
}
