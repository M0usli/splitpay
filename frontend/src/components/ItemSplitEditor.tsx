"use client";

import { useEffect, useState } from "react";

import { previewItemSplit, type Member, type SplitPreview } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { canSplitRow, emptyRow, splitRow, toSplitItems, type ItemRow } from "@/lib/itemSplit";
import { toCents } from "@/lib/split";

type ItemSplitEditorProps = {
  members: Member[];
  /** The logged-in user's id, shown as "Me". */
  myId: number;
  rows: ItemRow[];
  onChange: (rows: ItemRow[]) => void;
  /** The tax and total typed in the form above, used for the summary. */
  tax: string;
  total: string;
  currency: string;
};

type Summary =
  | { state: "idle"; message: string }
  | { state: "loaded"; preview: SplitPreview }
  | { state: "error"; message: string };

// How long to wait after the last change before asking the backend, so that
// typing a price does not send a request for every key pressed.
const PREVIEW_DELAY_MS = 400;

const textInputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";
const linkButtonClass = "text-xs text-zinc-600 underline hover:text-zinc-900";

/** The part of an email before the @, to keep the tick boxes short. */
function shortName(member: Member, myId: number): string {
  return member.id === myId ? "Me" : member.email.split("@")[0];
}

/** Each receipt line with tick boxes for who it is for, and a running summary. */
export default function ItemSplitEditor({
  members,
  myId,
  rows,
  onChange,
  tax,
  total,
  currency,
}: ItemSplitEditorProps) {
  const allIds = members.map((member) => member.id);

  function updateRow(key: number, changes: Partial<ItemRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function toggleMember(row: ItemRow, memberId: number, isIncluded: boolean) {
    const sharedBy = isIncluded
      ? [...row.sharedBy, memberId]
      : row.sharedBy.filter((id) => id !== memberId);
    updateRow(row.key, { sharedBy });
  }

  function replaceRow(row: ItemRow, replacement: ItemRow[]) {
    onChange(rows.flatMap((current) => (current.key === row.key ? replacement : [current])));
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((row, position) => (
          <li key={row.key} className="rounded-md border border-zinc-200 p-2">
            <div className="flex gap-2">
              <input
                type="text"
                aria-label={`Name of item ${position + 1}`}
                value={row.name}
                onChange={(event) => updateRow(row.key, { name: event.target.value })}
                className={`${textInputClass} min-w-0 flex-1`}
              />
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Price of item ${position + 1}`}
                value={row.price}
                onChange={(event) => updateRow(row.key, { price: event.target.value })}
                className={`${textInputClass} w-20 text-right`}
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {members.map((member) => (
                <label key={member.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    aria-label={`${shortName(member, myId)} shares item ${position + 1}`}
                    checked={row.sharedBy.includes(member.id)}
                    onChange={(event) => toggleMember(row, member.id, event.target.checked)}
                  />
                  {shortName(member, myId)}
                </label>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                className={linkButtonClass}
                onClick={() => updateRow(row.key, { sharedBy: allIds })}
              >
                Everyone
              </button>
              <button
                type="button"
                className={linkButtonClass}
                onClick={() => updateRow(row.key, { sharedBy: [myId] })}
              >
                Just me
              </button>
              <label className="flex items-center gap-1 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  aria-label={`Item ${position + 1} is taxed`}
                  checked={row.isTaxable}
                  onChange={(event) => updateRow(row.key, { isTaxable: event.target.checked })}
                />
                Taxed
              </label>
              {canSplitRow(row) && (
                <button
                  type="button"
                  className={linkButtonClass}
                  onClick={() => replaceRow(row, splitRow(row))}
                >
                  Split into {row.quantity} lines
                </button>
              )}
              <button
                type="button"
                className={`${linkButtonClass} ml-auto`}
                aria-label={`Remove item ${position + 1}`}
                onClick={() => replaceRow(row, [])}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
        onClick={() => onChange([...rows, emptyRow(allIds)])}
      >
        Add an item
      </button>

      <SplitSummary rows={rows} tax={tax} total={total} currency={currency} myId={myId} />
    </div>
  );
}

type SplitSummaryProps = Pick<ItemSplitEditorProps, "rows" | "tax" | "total" | "currency" | "myId">;

/** What each person pays, worked out by the backend as the rows change. */
function SplitSummary({ rows, tax, total, currency, myId }: SplitSummaryProps) {
  const [summary, setSummary] = useState<Summary>({ state: "idle", message: "" });

  // The rows are turned into text so the effect below runs only when their
  // content changes, not every time the parent draws again.
  const checked = toSplitItems(rows);
  const itemsJson = checked.ok ? JSON.stringify(checked.items) : null;
  const waitingFor = !checked.ok
    ? checked.message
    : toCents(total) === null
      ? "Enter the total to see what each person pays."
      : null;

  useEffect(() => {
    if (itemsJson === null || waitingFor !== null) {
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      previewItemSplit(JSON.parse(itemsJson), tax.trim() === "" ? null : tax.trim(), total.trim())
        .then((preview) => {
          if (isCurrent) {
            setSummary({ state: "loaded", preview });
          }
        })
        .catch((error: unknown) => {
          if (isCurrent) {
            const message = error instanceof Error ? error.message : "Something went wrong";
            setSummary({ state: "error", message });
          }
        });
    }, PREVIEW_DELAY_MS);
    // A newer change cancels the request that has not been sent yet and
    // ignores the answer of one that has.
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [itemsJson, waitingFor, tax, total]);

  if (waitingFor !== null) {
    return <p className="text-xs text-zinc-500">{waitingFor}</p>;
  }
  if (summary.state === "idle") {
    return <p className="text-xs text-zinc-500">Working out who pays what…</p>;
  }
  if (summary.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {summary.message}
      </p>
    );
  }

  const { people, difference } = summary.preview;
  return (
    <div className="rounded-md bg-zinc-50 p-3 text-sm" aria-label="Who pays what">
      <p className="font-medium">Who pays what</p>
      <ul className="mt-1 space-y-1">
        {people.map((person) => (
          <li key={person.member.id} className="flex justify-between gap-3">
            <span>
              {person.member.id === myId ? "Me" : person.member.email}
              <span className="text-xs text-zinc-500">
                {" "}
                (items {formatMoney(person.items, currency)}, tax{" "}
                {formatMoney(person.tax, currency)})
              </span>
            </span>
            <strong>{formatMoney(person.amount, currency)}</strong>
          </li>
        ))}
      </ul>
      {Number(difference) !== 0 && (
        <p className="mt-2 text-xs text-amber-800">
          The items and tax come to {formatMoney(difference.replace("-", ""), currency)}{" "}
          {difference.startsWith("-") ? "more" : "less"} than the total. The difference is spread
          in proportion to what each person pays. Check the items if that looks wrong.
        </p>
      )}
    </div>
  );
}
