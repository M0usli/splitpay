"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type FormEvent } from "react";

import {
  disableTwoStep,
  enableTwoStep,
  errorMessage,
  getTwoStep,
  startTwoStepSetup,
  type TwoStepSetup,
} from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "loaded"; isEnabled: boolean }
  | { state: "error"; message: string };

type Stage = { name: "idle" } | { name: "setup"; setup: TwoStepSetup } | { name: "turn-off" };

const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const primaryButtonClass =
  "rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 " +
  "disabled:bg-zinc-300";
const plainButtonClass =
  "rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100";

/** The field for the 6-digit code from the authenticator app. */
function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor="two-step-code" className="block text-sm font-medium text-zinc-700">
        6-digit code
      </label>
      <input
        id="two-step-code"
        required
        // Shows the number keys on a phone, and lets the phone offer the code.
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        title="The 6 digits your authenticator app shows"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        className="mt-1 w-40 rounded-xl border border-zinc-300 px-3 py-2.5 text-center text-lg tracking-widest focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  );
}

/** The two-step login card on the Security page: turn it on with an authenticator app, or off. */
export default function TwoStepLogin() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [code, setCode] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getTwoStep()
      .then((result) => {
        if (isCurrent) {
          setStatus({ state: "loaded", isEnabled: result.is_enabled });
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
    setCode("");
    setActionError(null);
    setStage(next);
  }

  /** Run a change. Returns true when it worked. */
  async function run(action: () => Promise<void>): Promise<boolean> {
    setIsBusy(true);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStart() {
    setNotice(null);
    await run(async () => {
      const setup = await startTwoStepSetup();
      go({ name: "setup", setup });
    });
  }

  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const turningOn = stage.name === "setup";
    const worked = await run(async () => {
      const result = turningOn ? await enableTwoStep(code) : await disableTwoStep(code);
      setStatus({ state: "loaded", isEnabled: result.is_enabled });
    });
    if (worked) {
      go({ name: "idle" });
      setNotice(turningOn ? "Two-step login is on." : "Two-step login is off.");
    } else {
      // A code is good once, so a refused one is cleared.
      setCode("");
    }
  }

  const alert = actionError !== null && (
    <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
      {actionError}
    </p>
  );

  return (
    <section className={cardClass} aria-labelledby="two-step-heading">
      <h2 id="two-step-heading" className="text-sm font-semibold text-zinc-700">
        Two-step login
      </h2>

      {status.state === "loading" && <p className="mt-2 text-sm text-zinc-500">Loading…</p>}
      {status.state === "error" && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {status.message}
        </p>
      )}

      {status.state === "loaded" && stage.name === "idle" && (
        <>
          <p className="mt-1 text-sm text-zinc-600">
            {status.isEnabled
              ? "On. Logging in needs your password and a code from your authenticator app."
              : "Off. With it on, logging in also needs a 6-digit code from an app on your phone, so a stolen password is not enough."}
          </p>
          {notice !== null && (
            <p role="status" className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
              ✓ {notice}
            </p>
          )}
          {alert}
          {status.isEnabled ? (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                go({ name: "turn-off" });
              }}
              className={`${plainButtonClass} mt-3`}
            >
              Turn off
            </button>
          ) : (
            <button type="button" disabled={isBusy} onClick={handleStart} className={`${primaryButtonClass} mt-3`}>
              Turn on two-step login
            </button>
          )}
        </>
      )}

      {stage.name === "setup" && (
        <form onSubmit={handleCode} className="mt-3 space-y-4">
          <div>
            <p className="text-sm font-medium text-zinc-700">
              1. Scan this with an authenticator app
            </p>
            <p className="text-xs text-zinc-500">
              For example Google Authenticator or Microsoft Authenticator.
            </p>
            <div className="mt-2">
              <QRCodeSVG value={stage.setup.uri} size={180} marginSize={2} title="Code for your authenticator app" />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Or type this key into the app: <span className="break-all font-mono">{stage.setup.secret}</span>
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-700">2. Enter the code the app shows</p>
            <div className="mt-2">
              <CodeField value={code} onChange={setCode} />
            </div>
          </div>
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            If you lose the phone you will not be able to log in. This demonstration has no
            recovery codes.
          </p>
          {alert}
          <div className="flex gap-2">
            <button type="submit" disabled={isBusy || code.length !== 6} className={primaryButtonClass}>
              Turn on
            </button>
            <button type="button" onClick={() => go({ name: "idle" })} className={plainButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {stage.name === "turn-off" && (
        <form onSubmit={handleCode} className="mt-3 space-y-4">
          <p className="text-sm text-zinc-600">
            Enter a code from your authenticator app to turn two-step login off.
          </p>
          <CodeField value={code} onChange={setCode} />
          {alert}
          <div className="flex gap-2">
            <button type="submit" disabled={isBusy || code.length !== 6} className={primaryButtonClass}>
              Turn off two-step login
            </button>
            <button type="button" onClick={() => go({ name: "idle" })} className={plainButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
