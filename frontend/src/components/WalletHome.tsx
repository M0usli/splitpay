"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import Wallet from "@/components/Wallet";
import { parsePayLink } from "@/lib/payLink";

/**
 * The wallet, opened either normally or from a scanned "pay me" code.
 *
 * useSearchParams reads the part of the address after the "?". That part is
 * only known in the browser, so the page wraps this component in <Suspense>.
 */
export default function WalletHome() {
  const searchParams = useSearchParams();
  const { auth } = useAuth();
  // Read once and kept: the link is removed from the address just below.
  const [payLink] = useState(() => parsePayLink(searchParams));

  const isSignedIn = auth.state === "signedIn";
  useEffect(() => {
    // Clean the address, so reloading the page does not open the payment
    // again. Not before logging in: the log-in page needs the link to come back.
    if (payLink !== null && isSignedIn) {
      window.history.replaceState(null, "", "/");
    }
  }, [payLink, isSignedIn]);

  return <Wallet payLink={payLink} />;
}
