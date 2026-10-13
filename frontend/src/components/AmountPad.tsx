"use client";

import type { KeyboardEvent } from "react";

import { displayAmount, PAD_KEYS, pressKey, type PadKey } from "@/lib/amountInput";

type AmountPadProps = {
  /** The amount so far, as text, for example "12.5". */
  value: string;
  onChange: (value: string) => void;
  /** Amounts offered as one-tap buttons, for example ["10", "20", "50"]. */
  quickAmounts: string[];
  /** What the amount is for, read out by screen readers: "Amount to send". */
  label: string;
};

/**
 * A large amount with one-tap amounts and a number pad under it, like a
 * payment app. Tapping is the main way in; on a computer the number keys,
 * the point and Backspace work too while the pad has focus.
 */
export default function AmountPad({ value, onChange, quickAmounts, label }: AmountPadProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key === "Backspace" ? "back" : event.key;
    if ((PAD_KEYS as string[]).includes(key)) {
      event.preventDefault();
      onChange(pressKey(value, key as PadKey));
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
    >
      {/* aria-live makes screen readers say the amount as it changes. */}
      <p aria-live="polite" className="text-center text-5xl font-semibold tracking-tight">
        <span className="align-top text-2xl text-zinc-400">$</span>
        <span data-testid="amount">{displayAmount(value)}</span>
      </p>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {quickAmounts.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onChange(amount)}
            className={
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors " +
              (value === amount
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-zinc-300 bg-white hover:border-emerald-400")
            }
          >
            ${amount}
          </button>
        ))}
      </div>

      <div className="mx-auto mt-4 grid max-w-xs grid-cols-3 gap-2">
        {PAD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={key === "back" ? "Erase" : key === "." ? "Point" : key}
            onClick={() => onChange(pressKey(value, key))}
            className="rounded-xl bg-zinc-100 py-3 text-xl font-medium hover:bg-zinc-200 active:bg-zinc-300"
          >
            {key === "back" ? "⌫" : key}
          </button>
        ))}
      </div>
    </div>
  );
}
