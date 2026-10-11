import { notFound } from "next/navigation";
import { Suspense } from "react";

import ReceiptReview from "@/components/ReceiptReview";
import { parseId } from "@/lib/params";

// The [id] folder name makes this a dynamic route: /receipts/7 renders this
// page with params.id === "7".
export default function ReceiptPage({ params }: PageProps<"/receipts/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Review receipt</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Compare the details with the receipt, fix anything that is wrong, then save.
      </p>

      <div className="mt-6">
        {/* The id is only known when a request arrives, so Next.js needs
            something to show until then. Suspense provides that fallback. */}
        <Suspense fallback={<p className="text-zinc-500">Loading receipt…</p>}>
          <ReceiptFromParams params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ReceiptFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receiptId = parseId(id);
  if (receiptId === null) {
    // An address like /receipts/abc can never match anything: show the 404 page.
    notFound();
  }
  return <ReceiptReview receiptId={receiptId} />;
}
