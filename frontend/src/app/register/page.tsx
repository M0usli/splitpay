import AuthForm from "@/components/AuthForm";

export default function RegisterPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
      <p className="mt-1 text-sm text-zinc-600">Create an account to track your expenses.</p>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
        <AuthForm mode="register" />
      </section>
    </main>
  );
}
