"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ExpenseForm, { type ExpenseFormValues } from "@/components/ExpenseForm";
import ReceiptImage from "@/components/ReceiptImage";
import ReceiptItems from "@/components/ReceiptItems";
import {
  createExpense,
  getReceipt,
  rerunExtraction,
  type ExpenseUpdate,
  type ExtractedFields,
  type Receipt,
} from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "loaded"; receipt: Receipt }
  | { state: "error"; message: string };

type ReceiptReviewProps = {
  receiptId: number;
};

/** Turn the AI's answer into starting values for the form. "Not found" becomes an empty input. */
function toFormValues(fields: ExtractedFields | null): Partial<ExpenseFormValues> {
  if (fields === null) {
    return {};
  }
  return {
    merchant: fields.merchant ?? "",
    date: fields.date ?? "",
    subtotal: fields.subtotal ?? "",
    tax: fields.tax ?? "",
    total: fields.total ?? "",
    currency: fields.currency ?? "CAD",
    category: fields.category ?? "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Review page: the receipt on the left, an editable form of the extracted fields on the right. */
export default function ReceiptReview({ receiptId }: ReceiptReviewProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    getReceipt(receiptId)
      .then((receipt) => setStatus({ state: "loaded", receipt }))
      .catch((error: unknown) => setStatus({ state: "error", message: errorMessage(error) }));
  }, [receiptId]);

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading receipt…</p>;
  }

  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  const { receipt } = status;
  const extracted = receipt.extracted_fields;
  const canExtract = extracted === null && receipt.raw_text !== null;
  const items = extracted?.items ?? [];
  // Receipts read before the app looked for items have none; reading them
  // again fills the items in.
  const canReadItems = extracted !== null && items.length === 0 && receipt.raw_text !== null;

  async function handleExtract() {
    setIsExtracting(true);
    try {
      const updated = await rerunExtraction(receipt.id);
      setStatus({ state: "loaded", receipt: updated });
    } catch (error) {
      setStatus({ state: "error", message: errorMessage(error) });
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleSave(expense: ExpenseUpdate) {
    await createExpense({ ...expense, receipt_id: receipt.id });
    router.push("/expenses");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <ReceiptImage receiptId={receipt.id} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Details
        </h2>

        {receipt.status === "failed" && (
          <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">The receipt could not be read automatically.</p>
            <p className="mt-1">{receipt.error_message}</p>
            <p className="mt-1">You can still enter the details by hand below.</p>
          </div>
        )}

        {receipt.warnings.length > 0 && (
          <div role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Please check these before saving:</p>
            <ul className="mt-1 list-disc pl-5">
              {receipt.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {extracted !== null && receipt.warnings.length === 0 && (
          <p className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
            These details were read from the receipt by AI. Check them, correct
            anything that is wrong, then save.
          </p>
        )}

        {canExtract && (
          <button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting}
            className="mb-4 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            {isExtracting ? "Reading with AI…" : "Read the details with AI"}
          </button>
        )}

        {canReadItems && (
          <button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting}
            className="mb-4 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            {isExtracting ? "Reading with AI…" : "Read the items with AI"}
          </button>
        )}

        {items.length > 0 && (
          <ReceiptItems items={items} currency={extracted?.currency ?? "CAD"} />
        )}

        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          {/* A changed key makes React throw the form away and build a new
              one, so a fresh AI answer replaces the old starting values. */}
          <ExpenseForm
            key={JSON.stringify(extracted)}
            submitLabel="Save expense"
            initialValues={toFormValues(extracted)}
            initialItems={items}
            onSubmit={handleSave}
          />
        </div>

        {receipt.raw_text !== null && (
          <details className="mt-4 rounded-lg border border-zinc-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700">
              Raw OCR text
            </summary>
            <pre className="overflow-x-auto whitespace-pre-wrap border-t border-zinc-200 p-4 font-mono text-xs leading-5">
              {receipt.raw_text}
            </pre>
          </details>
        )}
      </section>
    </div>
  );
}
