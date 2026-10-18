"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { errorMessage, getCurrentUser, runRecurring, type User } from "@/lib/api";

export type AuthStatus =
  | { state: "loading" }
  | { state: "signedOut" }
  | { state: "signedIn"; user: User }
  | { state: "error"; message: string };

type AuthContextValue = {
  auth: AuthStatus;
  /** Call after a successful log-in or sign-up. */
  signIn: (user: User) => void;
  /** Call after a successful log-out. */
  signOut: () => void;
};

// A context shares a value with every component below the provider, so the
// nav bar and the pages can all ask "who is logged in?" without passing
// props down through each layer.
const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return value;
}

/** Asks the backend once who is logged in and shares the answer with the app. */
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthStatus>({ state: "loading" });
  const signedInUserId = auth.state === "signedIn" ? auth.user.id : null;

  // Each time someone is signed in (the app opens, or they log in), make the
  // monthly expenses that have become due. The backend makes each one only
  // once, so calling this often is harmless. If it fails, nothing is lost:
  // the next visit tries again.
  useEffect(() => {
    if (signedInUserId !== null) {
      runRecurring().catch(() => {});
    }
  }, [signedInUserId]);

  // The login cookie is HttpOnly, so this code cannot read it. The only way
  // to know who is logged in is to ask the backend.
  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setAuth(user === null ? { state: "signedOut" } : { state: "signedIn", user });
      })
      .catch((error: unknown) => {
        setAuth({ state: "error", message: errorMessage(error) });
      });
  }, []);

  const value: AuthContextValue = {
    auth,
    signIn: (user) => setAuth({ state: "signedIn", user }),
    signOut: () => setAuth({ state: "signedOut" }),
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}
