import VerifyIdentity from "@/components/VerifyIdentity";

export default function VerifyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Verify your identity</h1>
      <p className="mt-1 text-sm text-zinc-600">
        A wallet has to know who is sending money. This takes about a minute.
      </p>

      <div className="mt-6">
        <VerifyIdentity />
      </div>
    </main>
  );
}
