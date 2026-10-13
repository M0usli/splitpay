"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PinEntry, { PIN_LENGTH } from "@/components/PinEntry";
import StepHeader from "@/components/StepHeader";
import { getPin, type PinStatus } from "@/lib/api";
import { helpLinkFor } from "@/lib/helpLink";

type PinPromptProps = {
  /** What is about to be paid, shown above the pad: "Send $20.00 to alex@example.com". */
  what: string;
  /** The reason the last try was refused, if it was. */
  error: string | null;
  isBusy: boolean;
  onBack: () => void;
  /** Called with the PIN once all four digits are in. */
  onSubmit: (pin: string) => Promise<void>;
};

const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm mx-auto max-w-md";

/**
 * The last step of every payment: enter the payment PIN.
 *
 * It first asks the backend whether the user has a PIN at all, and whether
 * it is locked after too many wrong tries, so it can say so before any typing.
 */
export default function PinPrompt({ what, error, isBusy, onBack, onSubmit }: PinPromptProps) {
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
  const [pin, setPin] = useState("");

  useEffect(() => {
    let isCurrent = true;
    getPin()
      .then((result) => {
        if (isCurrent) {
          setPinStatus(result);
        }
      })
      // If this cannot be loaded the pad is shown anyway; the backend still checks the PIN.
      .catch(() => {
        if (isCurrent) {
          setPinStatus({ is_set: true, locked_minutes: 0 });
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleChange(value: string) {
    setPin(value);
    if (value.length === PIN_LENGTH) {
      await onSubmit(value);
      // Cleared whatever happened: a wrong PIN is typed again from the start.
      setPin("");
    }
  }

  const helpLink = helpLinkFor(error);

  return (
    <section className={cardClass} aria-label="Enter your PIN">
      <StepHeader title="Enter your PIN" onBack={onBack} />
      <p className="mb-4 text-center text-sm text-zinc-600">{what}</p>

      {error !== null && (
        <div role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {helpLink !== null && (
            <Link href={helpLink.href} className="font-medium underline">
              {helpLink.label}
            </Link>
          )}
        </div>
      )}

      {pinStatus === null && <p className="text-center text-sm text-zinc-500">Loading…</p>}

      {pinStatus !== null && !pinStatus.is_set && (
        <div className="text-center">
          <p className="text-sm text-zinc-600">
            You need a payment PIN before you can pay. It takes a few seconds to make one.
          </p>
          <Link
            href="/security"
            className="mt-4 block rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-500"
          >
            Set a payment PIN
          </Link>
        </div>
      )}

      {pinStatus !== null && pinStatus.is_set && pinStatus.locked_minutes > 0 && error === null && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          Too many wrong PINs. Try again in {pinStatus.locked_minutes} minutes.
        </p>
      )}

      {pinStatus !== null && pinStatus.is_set && (
        <PinEntry value={pin} onChange={handleChange} label="Your payment PIN" disabled={isBusy} />
      )}
    </section>
  );
}
