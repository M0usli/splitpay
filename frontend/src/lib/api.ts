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
export type BankStatus = Schemas["BankStatus"];
export type BankTransaction = Schemas["BankTransactionRead"];
export type Recurring = Schemas["RecurringRead"];
export type Wallet = Schemas["WalletRead"];
export type WalletTransaction = Schemas["TransactionRead"];
export type TransferResult = Schemas["TransferResult"];
export type Limits = Schemas["LimitsRead"];
export type PinStatus = Schemas["PinRead"];
export type Notification = Schemas["NotificationRead"];
export type NotificationList = Schemas["NotificationList"];
export type MoneyRequest = Schemas["MoneyRequestRead"];
export type Identity = Schemas["IdentityRead"];
export type IdentitySubmit = Schemas["IdentitySubmit"];
export type DocumentType = Schemas["DocumentType"];
export type Biller = Schemas["BillerRead"];
export type SavedBiller = Schemas["SavedBillerRead"];
export type BillPayment = Schemas["BillPaymentRead"];
export type RecurringWrite = Schemas["RecurringWrite"];
export type User = Schemas["UserRead"];
export type Credentials = Schemas["Credentials"];

// Variables starting with NEXT_PUBLIC_ are made available to browser code.
const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Where the backend is, seen from the device showing the page.
 *
 * On this computer the page is opened as http://localhost:3000 and the
 * backend is http://localhost:8000. On a phone, "localhost" would mean the
 * phone itself. The phone opens the page by the computer's network address
 * (for example http://192.168.1.20:3000), so the backend is at that same
 * address: "localhost" in the configured URL is swapped for it.
 */
export function resolveApiUrl(configuredUrl: string, pageHostname: string | null): string {
  if (pageHostname === null || pageHostname === "localhost") {
    return configuredUrl;
  }
  const url = new URL(configuredUrl);
  if (url.hostname !== "localhost") {
    return configuredUrl;
  }
  url.hostname = pageHostname;
  // URL adds a "/" at the end; the paths in this file already start with one.
  return url.toString().replace(/\/$/, "");
}

const API_URL = resolveApiUrl(
  CONFIGURED_API_URL,
  // `window` only exists in the browser, not while the server prepares a page.
  typeof window === "undefined" ? null : window.location.hostname,
);

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

/**
 * A request that takes money out of the wallet. It carries the payment PIN
 * in a header, next to the JSON body.
 */
function payingRequest(body: unknown, pin: string): RequestInit {
  const init = jsonRequest("POST", body);
  return { ...init, headers: { ...init.headers, "X-Payment-Pin": pin } };
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

/**
 * Pay a housemate from the wallet. The money moves and the debt is marked
 * as paid together. A repeat with the same `requestId` pays only once.
 */
export function payFromWallet(
  toUserId: number,
  amount: string,
  requestId: string,
  pin: string,
): Promise<Settlement> {
  return request(
    "/household/pay",
    payingRequest({ to_user_id: toUserId, amount, idempotency_key: requestId }, pin),
  );
}

export function deleteSettlement(id: number): Promise<void> {
  return request(`/household/settlements/${id}`, { method: "DELETE" });
}

/** Whether the bank feature is set up, and the banks this user connected. */
export function getBankStatus(): Promise<BankStatus> {
  return request("/bank/status");
}

/** The token that opens Plaid's "choose your bank" window. */
export function createBankLinkToken(): Promise<{ link_token: string }> {
  return request("/bank/link-token", { method: "POST" });
}

/** Hand the backend the one-time token Plaid gave the browser. */
export function connectBank(publicToken: string, institutionName: string): Promise<unknown> {
  return request(
    "/bank/connections",
    jsonRequest("POST", { public_token: publicToken, institution_name: institutionName }),
  );
}

export function removeBankConnection(id: number): Promise<void> {
  return request(`/bank/connections/${id}`, { method: "DELETE" });
}

/** Import what is new at every connected bank. Safe to call again. */
export function syncBank(): Promise<{ imported: number; removed: number }> {
  return request("/bank/sync", { method: "POST" });
}

/** Imported transactions that are waiting for a decision. */
export function listBankTransactions(): Promise<BankTransaction[]> {
  return request("/bank/transactions");
}

/** Make an expense from an imported transaction. */
export function addBankTransaction(id: number, category: Category): Promise<Expense> {
  return request(`/bank/transactions/${id}/add`, jsonRequest("POST", { category }));
}

export function ignoreBankTransaction(id: number): Promise<BankTransaction> {
  return request(`/bank/transactions/${id}/ignore`, { method: "POST" });
}

export function getWallet(): Promise<Wallet> {
  return request("/wallet");
}

/** The user's notifications, newest first, with how many are unread. */
export function getNotifications(): Promise<NotificationList> {
  return request("/notifications");
}

export function markNotificationsRead(): Promise<void> {
  return request("/notifications/read", { method: "POST" });
}

/** Whether the user has a payment PIN, and whether it is locked. The PIN itself is never sent back. */
export function getPin(): Promise<PinStatus> {
  return request("/wallet/pin");
}

/** Create the payment PIN, or change it by giving the current one. */
export function setPin(pin: string, currentPin: string | null): Promise<PinStatus> {
  return request("/wallet/pin", jsonRequest("PUT", { pin, current_pin: currentPin }));
}

/**
 * One month of the wallet's history as a CSV file. `month` is "2026-10".
 * It is a file, not JSON, so it is returned as a Blob (a chunk of raw data).
 */
export async function downloadStatement(month: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/wallet/statement?month=${month}`, {
      credentials: "include",
    });
  } catch {
    throw new ApiError("Could not reach the backend. Is it running?", 0);
  }
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }
  return response.blob();
}

/** The daily sending limit, and how much of it is left today. */
export function getWalletLimits(): Promise<Limits> {
  return request("/wallet/limits");
}

/** Money in and out of the wallet, newest first. */
export function listWalletTransactions(): Promise<WalletTransaction[]> {
  return request("/wallet/transactions");
}

/**
 * Add pretend money to the wallet. `requestId` identifies this one action:
 * sending it again with the same id adds the money only once.
 */
export function topUpWallet(amount: string, requestId: string): Promise<TransferResult> {
  return request("/wallet/top-up", jsonRequest("POST", { amount, idempotency_key: requestId }));
}

/** Where the user's identity check stands: unverified, verified or rejected. */
export function getIdentity(): Promise<Identity> {
  return request("/identity");
}

/** Send details for an identity check. The answer comes back at once. */
export function submitIdentity(details: IdentitySubmit): Promise<Identity> {
  return request("/identity", jsonRequest("POST", details));
}

/** The (made-up) companies a bill can be paid to. */
export function listBillers(): Promise<Biller[]> {
  return request("/bills/billers");
}

/** The companies the user saved, each with the user's account number there. */
export function listSavedBillers(): Promise<SavedBiller[]> {
  return request("/bills/saved");
}

export function saveBiller(billerCode: string, accountNumber: string): Promise<SavedBiller> {
  return request(
    "/bills/saved",
    jsonRequest("POST", { biller_code: billerCode, account_number: accountNumber }),
  );
}

/** Forget a saved biller. Receipts of past payments are kept. */
export function removeSavedBiller(id: number): Promise<void> {
  return request(`/bills/saved/${id}`, { method: "DELETE" });
}

/**
 * Pay a bill from the wallet and get its receipt. A repeat with the same
 * `requestId` pays only once and returns the same receipt.
 */
export function payBill(
  savedBillerId: number,
  amount: string,
  requestId: string,
  pin: string,
): Promise<BillPayment> {
  return request(
    "/bills/pay",
    payingRequest({ saved_biller_id: savedBillerId, amount, idempotency_key: requestId }, pin),
  );
}

/** The user's bill receipts, newest first. */
export function listBillPayments(): Promise<BillPayment[]> {
  return request("/bills/payments");
}

/** Requests for money the user made or received, newest first. */
export function listMoneyRequests(): Promise<MoneyRequest[]> {
  return request("/wallet/requests");
}

/** Ask another user for money. Nothing moves until they pay. */
export function requestMoney(ask: {
  toEmail: string;
  amount: string;
  note: string | null;
}): Promise<MoneyRequest> {
  return request(
    "/wallet/requests",
    jsonRequest("POST", { to_email: ask.toEmail, amount: ask.amount, note: ask.note }),
  );
}

/** Pay a request from the wallet. A repeat with the same `requestId` pays only once. */
export function payMoneyRequest(
  id: number,
  requestId: string,
  pin: string,
): Promise<MoneyRequest> {
  return request(`/wallet/requests/${id}/pay`, payingRequest({ idempotency_key: requestId }, pin));
}

/** Say no to a request someone sent. */
export function declineMoneyRequest(id: number): Promise<MoneyRequest> {
  return request(`/wallet/requests/${id}/decline`, { method: "POST" });
}

/** Take back a request the user made. */
export function cancelMoneyRequest(id: number): Promise<MoneyRequest> {
  return request(`/wallet/requests/${id}/cancel`, { method: "POST" });
}

/** Send money to another user. A repeat with the same `requestId` moves it only once. */
export function sendMoney(
  send: { toEmail: string; amount: string; note: string | null },
  requestId: string,
  pin: string,
): Promise<TransferResult> {
  return request(
    "/wallet/send",
    payingRequest(
      {
        to_email: send.toEmail,
        amount: send.amount,
        note: send.note,
        idempotency_key: requestId,
      },
      pin,
    ),
  );
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
