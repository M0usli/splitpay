import ReceiptUpload from "@/components/ReceiptUpload";

export default function UploadPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Upload a receipt</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Add a photo or PDF of a receipt. The app reads the merchant, date and
        amounts for you to check before saving.
      </p>

      <div className="mt-6">
        <ReceiptUpload />
      </div>
    </main>
  );
}
