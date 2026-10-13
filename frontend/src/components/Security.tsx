"use client";

import { useEffect, useState } from "react";

import PinEntry, { PIN_LENGTH } from "@/components/PinEntry";
import StepHeader from "@/components/StepHeader";
import TwoStepLogin from "@/components/TwoStepLogin";
import { getPin, setPin, type PinStatus } from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "loaded"; pin: PinStatus }
  | { state: "error"; message: string };

/**
 * Where the user is in making or changing the PIN. The new PIN is entered
 * twice, because the digits are hidden and a slip would lock them out.
 */
type Stage =
  | { name: "idle" }
  | { name: "current" }
  | { name: "new"; currentPin: string | null }
  | { name: "repeat"; currentPin: string | null; newPin: string };

const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const primaryButtonClass =
  "rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

const TITLES = { current: "Your current PIN", new: "Choose a new PIN", repeat: "Enter it again" };

/** The Security page: the payment PIN and two-step login. */
export default function Security() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [entry, setEntry] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getPin()
      .then((pin) => {
        if (isCurrent) {
          setStatus({ state: "loaded", pin });
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

  function go(next: Stage) {
    setEntry("");
    setStage(next);
  }

  async function save(newPin: string, currentPin: string | null) {
    setIsBusy(true);
    try {
      const pin = await setPin(newPin, currentPin);
      setStatus({ state: "loaded", pin });
      setNotice(currentPin === null ? "Your payment PIN is set." : "Your payment PIN was changed.");
      go({ name: "idle" });
    } catch (error) {
      setActionError(errorMessage(error));
      // Start again from the first step, with the reason shown.
      go(currentPin === null ? { name: "new", currentPin: null } : { name: "current" });
    } finally {
      setIsBusy(false);
    }
  }

  function handleEntry(value: string) {
    setEntry(value);
    if (value.length < PIN_LENGTH) {
      return;
    }
    if (stage.name === "current") {
      go({ name: "new", currentPin: value });
    } else if (stage.name === "new") {
      setActionError(null);
      go({ name: "repeat", currentPin: stage.currentPin, newPin: value });
    } else if (stage.name === "repeat") {
      if (value !== stage.newPin) {
        setActionError("The two PINs were not the same. Try again.");
        go({ name: "new", currentPin: stage.currentPin });
      } else {
        void save(value, stage.currentPin);
      }
    }
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

  const { pin } = status;

  if (stage.name !== "idle") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Payment PIN">
        <StepHeader
          title={TITLES[stage.name]}
          onBack={() => {
            setActionError(null);
            go({ name: "idle" });
          }}
        />
        {actionError !== null && (
          <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError}
          </p>
        )}
        <PinEntry value={entry} onChange={handleEntry} label={TITLES[stage.name]} disabled={isBusy} />
        {stage.name === "new" && (
          <p className="mt-4 text-center text-xs text-zinc-500">
            Four digits. Not 1234 and not the same digit four times.
          </p>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {notice !== null && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ {notice}
        </p>
      )}

      <section className={cardClass} aria-labelledby="pin-heading">
        <h2 id="pin-heading" className="text-sm font-semibold text-zinc-700">
          Payment PIN
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {pin.is_set
            ? "Your PIN is asked for every time money leaves your wallet."
            : "You have no PIN yet. You need one to send money, pay a request or pay a bill."}
        </p>
        {pin.locked_minutes > 0 && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            Too many wrong PINs. Try again in {pin.locked_minutes} minutes.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setActionError(null);
            go(pin.is_set ? { name: "current" } : { name: "new", currentPin: null });
          }}
          className={`${primaryButtonClass} mt-3`}
        >
          {pin.is_set ? "Change PIN" : "Create a PIN"}
        </button>
      </section>

      <TwoStepLogin />
    </div>
  );
}
