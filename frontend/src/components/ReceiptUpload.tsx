"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type DragEvent } from "react";

import { uploadReceipt } from "@/lib/api";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// What happens after a receipt is chosen, shown under the upload box.
const STEPS = [
  { title: "Read", text: "The photo is cleaned up and the text is read." },
  { title: "Check", text: "You see the store, date, total and items, and fix anything." },
  { title: "Save or split", text: "Save it as an expense, or split it with your household." },
];

type Status =
  | { state: "idle" }
  | { state: "uploading"; fileName: string }
  // receiptId is set when the file was saved but could not be read, so the
  // user can still open it and type the details in.
  | { state: "error"; message: string; receiptId?: number };

/** Quick checks in the browser. The backend checks again; this just saves a round trip. */
function findProblem(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "That file type is not supported. Choose a JPG, PNG or PDF.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "That file is larger than 10 MB.";
  }
  return null;
}

export default function ReceiptUpload() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [isDragging, setIsDragging] = useState(false);

  const isUploading = status.state === "uploading";

  async function handleFile(file: File) {
    const problem = findProblem(file);
    if (problem !== null) {
      setStatus({ state: "error", message: problem });
      return;
    }

    setStatus({ state: "uploading", fileName: file.name });
    try {
      const receipt = await uploadReceipt(file);
      if (receipt.status === "failed") {
        setStatus({
          state: "error",
          message: receipt.error_message ?? "The receipt could not be read.",
          receiptId: receipt.id,
        });
        return;
      }
      router.push(`/receipts/${receipt.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Something went wrong";
      setStatus({ state: "error", message });
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    // Clear the input so choosing the same file again still triggers a change.
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    // Without this the browser refuses the drop and opens the file instead.
    event.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !isUploading) {
      handleFile(file);
    }
  }

  return (
    <div>
      {/* A label wraps the hidden file input, so clicking anywhere in the box opens the file picker. */}
      <label
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={
          "flex min-h-56 flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-10 text-center shadow-sm transition-colors " +
          "focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-200 " +
          (isUploading
            ? "cursor-wait border-emerald-300 bg-emerald-50"
            : isDragging
              ? "cursor-copy border-emerald-600 bg-emerald-50"
              : "cursor-pointer border-zinc-300 bg-white hover:border-emerald-400")
        }
      >
        <input
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          disabled={isUploading}
          onChange={handleInputChange}
          className="sr-only"
        />
        {status.state === "uploading" ? (
          <>
            <span
              aria-hidden
              className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"
            />
            <p role="status" className="mt-4 font-medium">
              Reading your receipt…
            </p>
            <p className="mt-1 text-sm text-zinc-500">{status.fileName}</p>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700"
            >
              ⇪
            </span>
            <p className="text-lg font-medium">
              {isDragging ? (
                "Drop the receipt here"
              ) : (
                <>
                  {/* Nobody drags files on a phone, so small screens get shorter words. */}
                  <span className="hidden md:inline">
                    Drag a receipt here, or click to choose a file
                  </span>
                  <span className="md:hidden">Tap to choose a file</span>
                </>
              )}
            </p>
            <p className="mt-1 text-sm text-zinc-500">JPG, PNG or PDF, up to 10 MB</p>
          </>
        )}
      </label>

      {/* On a phone, capture="environment" makes this input open the back
          camera instead of the file list. Computers ignore it and show the
          usual file picker, so the button is only shown on small screens. */}
      <label
        className={
          "mt-3 flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white hover:bg-emerald-500 md:hidden " +
          (isUploading ? "cursor-wait opacity-50" : "cursor-pointer")
        }
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={isUploading}
          onChange={handleInputChange}
          className="sr-only"
        />
        Take a photo of a receipt
      </label>

      {status.state === "error" && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {status.message}
          {status.receiptId !== undefined && (
            <>
              {" "}
              <Link href={`/receipts/${status.receiptId}`} className="font-medium underline">
                Enter the details by hand
              </Link>
            </>
          )}
        </p>
      )}

      <section aria-label="What happens next" className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-700">What happens next</h2>
        <ol className="mt-3 space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white"
              >
                {index + 1}
              </span>
              <p className="text-sm">
                <span className="font-medium">{step.title}.</span>{" "}
                <span className="text-zinc-600">{step.text}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
