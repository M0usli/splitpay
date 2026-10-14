"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/AuthProvider";
import { ApiError, login, register } from "@/lib/api";

type AuthFormProps = {
  /** "login" for an existing account, "register" to create one. */
  mode: "login" | "register";
};

const MIN_PASSWORD_LENGTH = 8;

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm " +
  "focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelClass = "block text-sm font-medium text-zinc-700";

/** The email and password form used by both the log-in and the sign-up page. */
export default function AuthForm({ mode }: AuthFormProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the backend says this account has two-step login.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The backend checks this too. Checking here gives a faster, clearer answer.
    if (isRegister && password.length < MIN_PASSWORD_LENGTH) {
      setError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const credentials = { email: email.trim(), password };
      const user = isRegister
        ? await register(credentials)
        : await login(needsCode ? { ...credentials, code } : credentials);
      // Telling the app who is logged in makes RequireLogin open the home page.
      signIn(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
      // 403 on logging in means: the password was right, and this account
      // also needs the code from its authenticator app.
      if (!isRegister && caught instanceof ApiError && caught.status === 403) {
        setNeedsCode(true);
        setCode("");
      }
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          // autoComplete tells password managers which box is which.
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          maxLength={128}
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
        {isRegister && (
          <p className="mt-1 text-xs text-zinc-500">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        )}
      </div>

      {needsCode && (
        <div>
          <label htmlFor="login-code" className={labelClass}>
            6-digit code
          </label>
          <input
            id="login-code"
            required
            autoFocus
            // Shows the number keys on a phone, and lets the phone offer the code.
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">From the authenticator app on your phone.</p>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-500 disabled:bg-zinc-300"
      >
        {isSubmitting ? "Please wait…" : isRegister ? "Create account" : "Log in"}
      </button>

      <p className="text-sm text-zinc-600">
        {isRegister ? "Already have an account? " : "No account yet? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-medium text-zinc-900 underline"
        >
          {isRegister ? "Log in" : "Sign up"}
        </Link>
      </p>
    </form>
  );
}
