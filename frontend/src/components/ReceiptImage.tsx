"use client";

import { useState } from "react";

import { receiptImageUrl } from "@/lib/api";

type ReceiptImageProps = {
  receiptId: number;
};

/** The receipt picture, with a switch to see the cleaned-up version OCR read. */
export default function ReceiptImage({ receiptId }: ReceiptImageProps) {
  const [showProcessed, setShowProcessed] = useState(false);

  const toggleClass = (isActive: boolean) =>
    "rounded-md px-3 py-1 text-sm font-medium " +
    (isActive ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100");

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Receipt
        </h2>
        <div className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1">
          <button
            type="button"
            aria-pressed={!showProcessed}
            onClick={() => setShowProcessed(false)}
            className={toggleClass(!showProcessed)}
          >
            Original
          </button>
          <button
            type="button"
            aria-pressed={showProcessed}
            onClick={() => setShowProcessed(true)}
            className={toggleClass(showProcessed)}
          >
            What OCR sees
          </button>
        </div>
      </div>
      {/* A plain <img> is used on purpose: next/image would fetch the file
          from the frontend server, which cannot reach the backend's URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={receiptImageUrl(receiptId, showProcessed)}
        alt={showProcessed ? "Receipt after image clean-up" : "Uploaded receipt"}
        className="w-full rounded-lg border border-zinc-200 bg-white"
      />
    </section>
  );
}
