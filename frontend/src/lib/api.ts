// All calls to the backend REST API go through this file.

// api-types.ts is generated from the backend's OpenAPI schema by
// `npm run generate:api`, so these types always match the Pydantic schemas.
import type { components } from "./api-types";

export { categoryValues as CATEGORIES } from "./api-types";

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type Category = Schemas["Category"];
export type Expense = Schemas["ExpenseRead"];
export type ExpenseCreate = Schemas["ExpenseCreate"];
export type ExpenseUpdate = Schemas["ExpenseUpdate"];
// One person's part of a shared expense, as the API returns it.
export type Share = Schemas["Share-Output"];
// One receipt line and the members who share it.
export type SplitItem = Schemas["SplitItem-Output"];
export type SplitPreview = Schemas["SplitPreviewRead"];
export type Receipt = Schemas["ReceiptRead"];
export type ExtractedFields = Schemas["ExtractedFields"];
export type ExtractedItem = Schemas["ExtractedItem"];
export type StatsSummary = Schemas["StatsSummary"];
export type Household = Schemas["HouseholdRead"];
export type Member = Schemas["MemberRead"];
export type SharedExpense = Schemas["SharedExpenseRead"];
export type Balance = Schemas["BalanceRead"];
export type Settlement = Schemas["SettlementRead"];
export type Recurring = Schemas["RecurringRead"];
export type RecurringWrite = Schemas["RecurringWrite"];
export type User = Schemas["UserRead"];
export type Credentials = Schemas["Credentials"];

// Variables starting with NEXT_PUBLIC_ are made available to browser code.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** An error from the API, with a message that is safe to show the user. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// FastAPI puts error details in a "detail" field: a string for errors we
// raise ourselves, or a list of problems when request validation fails.
type ErrorBody = {
  detail?: string | Schemas["ValidationError"][];
};

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: ErrorBody = await response.json();
    if (typeof body.detail === "string") {
      return body.detail;
    }
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((problem) => `${problem.loc.at(-1)}: ${problem.msg}`)
        .join("; ");
    }
  } catch {
    // The response body was not JSON; fall through to the generic message.
  }
  return `Request failed with status ${response.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // The backend is a different origin (another port), so the browser only
    // sends the login cookie along when we ask for it with "include".
    response = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  } catch {
    throw new ApiError("Could not reach the backend. Is it running?", 0);
  }
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  // 204 means "done, nothing to send back" (used by DELETE), so there is no JSON to read.
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function getHealth(): Promise<HealthResponse> {
  return request("/health");
}

/** Create an account. The backend also logs the new user in. */
export function register(credentials: Credentials): Promise<User> {
  return request("/auth/register", jsonRequest("POST", credentials));
}

export function login(credentials: Credentials): Promise<User> {
  return request("/auth/login", jsonRequest("POST", credentials));
}

export function logout(): Promise<void> {
  return request("/auth/logout", { method: "POST" });
}

/** The logged-in user, or null if nobody is logged in. */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await request<User>("/auth/me");
  } catch (error) {
    // 401 is the backend's normal answer for "not logged in", not a failure.
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

/** The logged-in user's household, or null if they are not in one. */
export async function getHousehold(): Promise<Household | null> {
  try {
    return await request<Household>("/household");
  } catch (error) {
    // 404 is the backend's normal answer for "you are not in a household".
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function createHousehold(name: string): Promise<Household> {
  return request("/household", jsonRequest("POST", { name }));
}

export function joinHousehold(inviteCode: string): Promise<Household> {
  return request("/household/join", jsonRequest("POST", { invite_code: inviteCode }));
}

export function leaveHousehold(): Promise<void> {
  return request("/household/leave", { method: "POST" });
}

export function listSharedExpenses(): Promise<SharedExpense[]> {
  return request("/household/expenses");
}

/** Each member's position and the payments that would settle the household. */
export function getBalance(): Promise<Balance> {
  return request("/household/balance");
}

/** What each member would pay for these items. Nothing is saved. */
export function previewItemSplit(
  items: SplitItem[],
  tax: string | null,
  total: string,
): Promise<SplitPreview> {
  return request(
    "/household/split-preview",
    jsonRequest("POST", { split_items: items, tax, total }),
  );
}

export function listSettlements(): Promise<Settlement[]> {
  return request("/household/settlements");
}

/** Record that the logged-in user paid `toUserId` back. */
export function recordSettlement(toUserId: number, amount: string): Promise<Settlement> {
  return request("/household/settlements", jsonRequest("POST", { to_user_id: toUserId, amount }));
}

export function deleteSettlement(id: number): Promise<void> {
  return request(`/household/settlements/${id}`, { method: "DELETE" });
}

export function listRecurring(): Promise<Recurring[]> {
  return request("/recurring");
}

export function createRecurring(recurring: RecurringWrite): Promise<Recurring> {
  return request("/recurring", jsonRequest("POST", recurring));
}

export function updateRecurring(id: number, recurring: RecurringWrite): Promise<Recurring> {
  return request(`/recurring/${id}`, jsonRequest("PUT", recurring));
}

export function deleteRecurring(id: number): Promise<void> {
  return request(`/recurring/${id}`, { method: "DELETE" });
}

/**
 * Make the monthly expenses that are due and do not exist yet. Safe to call
 * any number of times. Returns the expenses it made.
 */
export function runRecurring(): Promise<Expense[]> {
  return request("/recurring/run", { method: "POST" });
}

/** Which expenses to show. An empty string means "no filter". */
export type ExpenseFilters = {
  month: string; // "YYYY-MM"
  category: Category | "";
};

/** Build "?month=2026-10&category=Dining" from the filters that are set. */
function filterQuery(filters: ExpenseFilters): string {
  const params = new URLSearchParams();
  if (filters.month !== "") {
    params.set("month", filters.month);
  }
  if (filters.category !== "") {
    params.set("category", filters.category);
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function listExpenses(filters: ExpenseFilters): Promise<Expense[]> {
  return request(`/expenses${filterQuery(filters)}`);
}

export function getExpense(id: number): Promise<Expense> {
  return request(`/expenses/${id}`);
}

export function createExpense(expense: ExpenseCreate): Promise<Expense> {
  return request("/expenses", jsonRequest("POST", expense));
}

export function updateExpense(id: number, expense: ExpenseUpdate): Promise<Expense> {
  return request(`/expenses/${id}`, jsonRequest("PUT", expense));
}

export function deleteExpense(id: number): Promise<void> {
  return request(`/expenses/${id}`, { method: "DELETE" });
}

/** URL that downloads the filtered expenses as a CSV file. */
export function expensesExportUrl(filters: ExpenseFilters): string {
  return `${API_URL}/expenses/export.csv${filterQuery(filters)}`;
}

export function uploadReceipt(file: File): Promise<Receipt> {
  // FormData sends the file the same way an HTML form upload does. The
  // browser sets the Content-Type header (multipart/form-data) by itself.
  const form = new FormData();
  form.append("file", file);
  return request("/receipts", { method: "POST", body: form });
}

export function getReceipt(id: number): Promise<Receipt> {
  return request(`/receipts/${id}`);
}

/** The Dashboard's numbers for one month ("YYYY-MM"). */
export function getStatsSummary(month: string): Promise<StatsSummary> {
  return request(`/stats/summary?month=${month}`);
}

/** Ask the backend to run the AI extraction again on a receipt's OCR text. */
export function rerunExtraction(id: number): Promise<Receipt> {
  return request(`/receipts/${id}/extract`, { method: "POST" });
}

/** URL of the receipt picture. `processed` gives the cleaned-up version OCR read. */
export function receiptImageUrl(id: number, processed = false): string {
  return `${API_URL}/receipts/${id}/image${processed ? "?processed=true" : ""}`;
}
