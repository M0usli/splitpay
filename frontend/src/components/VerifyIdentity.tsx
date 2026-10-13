"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import StepHeader from "@/components/StepHeader";
import { getIdentity, submitIdentity, type DocumentType, type Identity } from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "loaded"; identity: Identity }
  | { state: "error"; message: string };

/** The form is filled in over three short steps. */
type Step = "about" | "document" | "review";

const COUNTRIES = [
  { code: "CA", name: "Canada" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "United Arab Emirates" },
] as const;
type CountryCode = (typeof COUNTRIES)[number]["code"];

const DOCUMENTS: { type: DocumentType; name: string }[] = [
  { type: "passport", name: "Passport" },
  { type: "drivers_licence", name: "Driver's licence" },
  { type: "national_id", name: "National ID" },
];

const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const primaryButtonClass =
  "w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white " +
  "hover:bg-emerald-500 disabled:bg-zinc-300";
const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm " +
  "focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const choiceClass = "rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors";
const chosenClass = " border-emerald-600 bg-emerald-600 text-white";
const notChosenClass = " border-zinc-300 bg-white hover:border-emerald-400";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function documentName(type: DocumentType | null | undefined): string {
  return DOCUMENTS.find((document) => document.type === type)?.name ?? "Document";
}

/** One line of the summary: a label on the left and its value on the right. */
function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** The identity check: who you are and which document proves it. A simulation. */
export default function VerifyIdentity() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [step, setStep] = useState<Step>("about");
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // True while a rejected user is filling the form in again.
  const [isRetrying, setIsRetrying] = useState(false);

  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [country, setCountry] = useState<CountryCode | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType | null>(null);
  const [documentNumber, setDocumentNumber] = useState("");

  useEffect(() => {
    let isCurrent = true;
    getIdentity()
      .then((identity) => {
        if (isCurrent) {
          setStatus({ state: "loaded", identity });
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

  async function handleSubmit() {
    if (country === null || documentType === null) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      const identity = await submitIdentity({
        full_name: fullName,
        date_of_birth: dateOfBirth,
        country,
        document_type: documentType,
        document_number: documentNumber,
      });
      setStatus({ state: "loaded", identity });
      setIsRetrying(false);
      setStep("about");
      // The number is not needed again, so it does not stay in the page.
      setDocumentNumber("");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleAbout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep("document");
  }

  function handleDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep("review");
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

  const { identity } = status;

  if (identity.status === "verified") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Verified">
        <p role="status" className="text-center text-lg font-semibold text-green-700">
          ✓ Your identity is verified
        </p>
        <p className="mt-1 text-center text-sm text-zinc-600">You can send money and pay bills.</p>
        <dl className="mt-4 divide-y divide-zinc-100">
          <SummaryLine label="Name" value={identity.full_name ?? ""} />
          <SummaryLine
            label={documentName(identity.document_type)}
            value={`ends in ${identity.document_last4 ?? ""}`}
          />
        </dl>
        <Link href="/" className={`${primaryButtonClass} mt-4 block text-center`}>
          Go to your wallet
        </Link>
      </section>
    );
  }

  if (identity.status === "rejected" && !isRetrying) {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Not verified">
        <p className="text-center text-lg font-semibold text-red-700">We could not verify you</p>
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {identity.rejection_reason}
        </p>
        <button type="button" onClick={() => setIsRetrying(true)} className={`${primaryButtonClass} mt-4`}>
          Try again
        </button>
      </section>
    );
  }

  if (step === "about") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="About you">
        <h2 className="text-lg font-semibold">About you</h2>
        <p className="mt-1 text-sm text-zinc-600">Step 1 of 3. As written on your document.</p>
        <form onSubmit={handleAbout} className="mt-4 space-y-4">
          <div>
            <label htmlFor="full-name" className="block text-sm font-medium text-zinc-700">
              Full name
            </label>
            <input
              id="full-name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="date-of-birth" className="block text-sm font-medium text-zinc-700">
              Date of birth
            </label>
            <input
              id="date-of-birth"
              type="date"
              required
              min="1900-01-01"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-zinc-500">You must be 18 or older to send money.</p>
          </div>
          <button type="submit" className={primaryButtonClass}>
            Continue
          </button>
        </form>
      </section>
    );
  }

  if (step === "document") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Your document">
        <StepHeader title="Your document" onBack={() => setStep("about")} />
        <p className="-mt-2 mb-4 text-sm text-zinc-600">Step 2 of 3.</p>
        <form onSubmit={handleDocument} className="space-y-4">
          {/* fieldset and legend group a set of choices under one question. */}
          <fieldset>
            <legend className="text-sm font-medium text-zinc-700">Country that issued it</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {COUNTRIES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  aria-pressed={country === item.code}
                  onClick={() => setCountry(item.code)}
                  className={choiceClass + (country === item.code ? chosenClass : notChosenClass)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium text-zinc-700">Kind of document</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DOCUMENTS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  aria-pressed={documentType === item.type}
                  onClick={() => setDocumentType(item.type)}
                  className={choiceClass + (documentType === item.type ? chosenClass : notChosenClass)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="document-number" className="block text-sm font-medium text-zinc-700">
              Document number
            </label>
            <input
              id="document-number"
              required
              autoComplete="off"
              minLength={6}
              maxLength={20}
              // The same rule the backend checks: letters, digits and dashes.
              pattern="[A-Za-z0-9\-]+"
              title="6 to 20 letters, digits or dashes"
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              className={`${inputClass} uppercase`}
            />
            <p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This is a demonstration. Do not type a real document number: make one up, for example
              P1234567. A number ending in 0000 is always rejected, so you can see what that looks
              like.
            </p>
          </div>
          <button
            type="submit"
            disabled={country === null || documentType === null}
            className={primaryButtonClass}
          >
            Review
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className={`${cardClass} mx-auto max-w-md`} aria-label="Check your details">
      <StepHeader title="Check your details" onBack={() => setStep("document")} />
      <p className="-mt-2 mb-2 text-sm text-zinc-600">Step 3 of 3.</p>
      {actionError !== null && (
        <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
      <dl className="divide-y divide-zinc-100">
        <SummaryLine label="Name" value={fullName.trim()} />
        <SummaryLine label="Date of birth" value={dateOfBirth} />
        <SummaryLine
          label="Country"
          value={COUNTRIES.find((item) => item.code === country)?.name ?? ""}
        />
        <SummaryLine label={documentName(documentType)} value={documentNumber.trim().toUpperCase()} />
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        Only the last 4 characters of the document number are kept after the check.
      </p>
      <button type="button" disabled={isBusy} onClick={handleSubmit} className={`${primaryButtonClass} mt-4`}>
        {isBusy ? "Checking…" : "Submit"}
      </button>
    </section>
  );
}
