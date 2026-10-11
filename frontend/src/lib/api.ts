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
export type Receipt = Schemas["ReceiptRead"];
export type ExtractedFields = Schemas["ExtractedFields"];
export type StatsSummary = Schemas["StatsSummary"];

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
    response = await fetch(`${API_URL}${path}`, init);
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
