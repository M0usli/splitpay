import { expect, test } from "vitest";

import { buildPayLink, isLocalOnly, parsePayLink, payLinkOrigin } from "@/lib/payLink";
import { loginPathFor, safeReturnPath } from "@/lib/returnPath";

const ORIGIN = "http://192.168.1.20:3000";

/** The query string of a link, as the page that opens it would read it. */
function queryOf(link: string): URLSearchParams {
  return new URL(link).searchParams;
}

test("a link without an amount lets the payer choose", () => {
  const link = buildPayLink(ORIGIN, "sam@example.com", null);

  expect(link).toBe("http://192.168.1.20:3000/?pay=sam%40example.com");
  expect(parsePayLink(queryOf(link))).toEqual({ toEmail: "sam@example.com", amount: null });
});

test("a link can carry a fixed amount", () => {
  const link = buildPayLink(ORIGIN, "sam@example.com", "12.50");

  expect(parsePayLink(queryOf(link))).toEqual({ toEmail: "sam@example.com", amount: "12.50" });
});

test("an email with special characters survives the round trip", () => {
  const link = buildPayLink(ORIGIN, "sam+home&work@example.com", "5");

  expect(parsePayLink(queryOf(link))?.toEmail).toBe("sam+home&work@example.com");
});

test("an address without a pay link gives nothing", () => {
  expect(parsePayLink(new URLSearchParams(""))).toBeNull();
  expect(parsePayLink(new URLSearchParams("amount=5"))).toBeNull();
  expect(parsePayLink(new URLSearchParams("pay=not-an-email"))).toBeNull();
});

test("the email is tidied the way the backend stores it", () => {
  expect(parsePayLink(new URLSearchParams("pay=%20Sam@Example.com%20"))?.toEmail).toBe(
    "sam@example.com",
  );
});

test("an amount that is not a positive amount of money is dropped", () => {
  for (const bad of ["0", "0.00", "-5", "abc", "1.999", "1e3", "123456", ""]) {
    const params = new URLSearchParams({ pay: "sam@example.com", amount: bad });
    expect(parsePayLink(params)).toEqual({ toEmail: "sam@example.com", amount: null });
  }
});

test("the code uses the phone address when the page is open on localhost", () => {
  expect(payLinkOrigin("http://localhost:3000", "http://192.168.1.20:3000/")).toBe(ORIGIN);
  // Already opened by its network address, or no phone address set: keep the page's.
  expect(payLinkOrigin(ORIGIN, "http://10.0.0.5:3000")).toBe(ORIGIN);
  expect(payLinkOrigin("http://localhost:3000", "")).toBe("http://localhost:3000");
});

test("a localhost address is one a phone cannot open", () => {
  expect(isLocalOnly("http://localhost:3000")).toBe(true);
  expect(isLocalOnly(ORIGIN)).toBe(false);
});

// --- coming back after logging in ---

test("the log-in address remembers the page, except the home page", () => {
  expect(loginPathFor("/")).toBe("/login");
  expect(loginPathFor("/?pay=sam%40example.com&amount=5")).toBe(
    "/login?next=%2F%3Fpay%3Dsam%2540example.com%26amount%3D5",
  );
});

test("after logging in, only a path inside the app is followed", () => {
  expect(safeReturnPath("/expenses")).toBe("/expenses");
  expect(safeReturnPath("/?pay=sam%40example.com")).toBe("/?pay=sam%40example.com");
  for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "expenses"]) {
    expect(safeReturnPath(bad)).toBe("/");
  }
});
