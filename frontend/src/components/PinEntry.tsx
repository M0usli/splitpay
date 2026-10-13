"use client";

import type { KeyboardEvent } from "react";

export const PIN_LENGTH = 4;

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

type PinEntryProps = {
  /** The digits entered so far, for example "48". */
  value: string;
  onChange: (value: string) => void;
  /** What the PIN is for, read out by screen readers: "Your PIN". */
  label: string;
  disabled?: boolean;
};

/**
 * Four dots and a number pad. The digits are never shown, only how many
 * have been entered, so someone looking over a shoulder cannot read the PIN.
 */
export default function PinEntry({ value, onChange, label, disabled = false }: PinEntryProps) {
  function press(digit: string) {
    if (!disabled && value.length < PIN_LENGTH) {
      onChange(value + digit);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  const keyClass =
    "rounded-xl bg-zinc-100 py-3 text-xl font-medium hover:bg-zinc-200 active:bg-zinc-300 " +
    "disabled:opacity-50";

  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
    >
      {/* aria-live makes screen readers say how many digits are in, never which. */}
      <p aria-live="polite" className="sr-only">
        {value.length} of {PIN_LENGTH} digits entered
      </p>
      <div aria-hidden className="flex justify-center gap-4 py-2">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={
              "h-4 w-4 rounded-full border-2 " +
              (index < value.length ? "border-emerald-600 bg-emerald-600" : "border-zinc-300")
            }
          />
        ))}
      </div>

      <div className="mx-auto mt-4 grid max-w-xs grid-cols-3 gap-2">
        {DIGITS.map((digit) => (
          <button key={digit} type="button" disabled={disabled} onClick={() => press(digit)} className={keyClass}>
            {digit}
          </button>
        ))}
        <span />
        <button type="button" disabled={disabled} onClick={() => press("0")} className={keyClass}>
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="Erase"
          onClick={() => onChange(value.slice(0, -1))}
          className={keyClass}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
