import AuthForm from "@/components/AuthForm";
import AuthHero from "@/components/AuthHero";

export default function RegisterPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-6 py-10">
      <AuthHero />

      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Sign up</h1>
      <p className="mt-1 text-sm text-zinc-600">Create an account to track your expenses.</p>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <AuthForm mode="register" />
      </section>
    </main>
  );
}
