"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { getHousehold, type Household } from "@/lib/api";

export type HouseholdInfo = {
  household: Household;
  /** The logged-in user's id, to tell "me" apart from the other members. */
  myId: number;
};

/**
 * The logged-in user's household, or null while loading, when they are not
 * in one, or when it could not be loaded. Used by forms that only offer
 * sharing when there is someone to share with.
 */
export function useHousehold(): HouseholdInfo | null {
  const { auth } = useAuth();
  const [household, setHousehold] = useState<Household | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getHousehold()
      .then((loaded) => {
        if (isCurrent) {
          setHousehold(loaded);
        }
      })
      // Sharing is an extra: if this fails the form still works without it.
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, []);

  if (household === null || auth.state !== "signedIn") {
    return null;
  }
  return { household, myId: auth.user.id };
}
