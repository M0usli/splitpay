import BankImport from "@/components/BankImport";

export default function BankPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Bank</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Connect a bank and turn its transactions into expenses, instead of typing them in.
      </p>

      <div className="mt-6">
        <BankImport />
      </div>
    </main>
  );
}
