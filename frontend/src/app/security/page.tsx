import Security from "@/components/Security";

export default function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
      <p className="mt-1 text-sm text-zinc-600">What protects your money and your account.</p>

      <div className="mt-6">
        <Security />
      </div>
    </main>
  );
}
