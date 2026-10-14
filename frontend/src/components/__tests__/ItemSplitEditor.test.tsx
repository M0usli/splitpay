import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import ItemSplitEditor from "@/components/ItemSplitEditor";
import { previewItemSplit, type ExtractedItem, type Member, type SplitPreview } from "@/lib/api";
import { rowsFromExtracted, type ItemRow } from "@/lib/itemSplit";

// The summary asks the backend; these tests answer for it.
vi.mock("@/lib/api", async (importOriginal) => ({
  errorMessage: (await importOriginal<typeof import("@/lib/api")>()).errorMessage,
  previewItemSplit: vi.fn(),
}));

const SAM: Member = { id: 1, email: "sam@example.com" };
const ALEX: Member = { id: 2, email: "alex@example.com" };
const MEMBERS = [SAM, ALEX];

const ITEMS: ExtractedItem[] = [
  { name: "MILK", quantity: null, price: "6.49", is_taxable: false },
  { name: "YOGURT", quantity: 2, price: "7.98", is_taxable: null },
];

const PREVIEW: SplitPreview = {
  difference: "0.00",
  people: [
    { member: SAM, items: "10.48", tax: "0.00", adjustment: "0.00", amount: "10.48" },
    { member: ALEX, items: "3.99", tax: "0.00", adjustment: "0.00", amount: "3.99" },
  ],
};

/** Renders the editor with real state and returns a way to read the rows. */
function renderEditor(total = "14.47") {
  let latest: ItemRow[] = [];
  function Wrapper() {
    const [rows, setRows] = useState(() => rowsFromExtracted(ITEMS, [1, 2]));
    latest = rows;
    return (
      <ItemSplitEditor
        members={MEMBERS}
        myId={1}
        rows={rows}
        onChange={setRows}
        tax=""
        total={total}
        currency="CAD"
      />
    );
  }
  render(<Wrapper />);
  return () => latest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewItemSplit).mockResolvedValue(PREVIEW);
});

test("shows every item ticked for everyone to start with", () => {
  renderEditor();

  expect(screen.getByLabelText("Name of item 1")).toHaveValue("MILK");
  expect(screen.getByLabelText("Price of item 2")).toHaveValue("7.98");
  expect(screen.getByLabelText("Me shares item 1")).toBeChecked();
  expect(screen.getByLabelText("alex shares item 1")).toBeChecked();
});

test("unticking a person takes them off that item only", async () => {
  const rows = renderEditor();

  await userEvent.click(screen.getByLabelText("alex shares item 1"));

  expect(rows()[0].sharedBy).toEqual([1]);
  expect(rows()[1].sharedBy).toEqual([1, 2]);
});

test("Just me and Everyone set the people in one click", async () => {
  const rows = renderEditor();
  const firstItem = screen.getAllByRole("listitem")[0];

  await userEvent.click(within(firstItem).getByRole("button", { name: "Just me" }));
  expect(rows()[0].sharedBy).toEqual([1]);

  await userEvent.click(within(firstItem).getByRole("button", { name: "Everyone" }));
  expect(rows()[0].sharedBy).toEqual([1, 2]);
});

test("a line with a quantity can be split so each unit goes to one person", async () => {
  const rows = renderEditor();

  await userEvent.click(screen.getByRole("button", { name: "Split into 2 lines" }));

  expect(rows().map((item) => [item.name, item.price])).toEqual([
    ["MILK", "6.49"],
    ["YOGURT", "3.99"],
    ["YOGURT", "3.99"],
  ]);
  // The milk has no quantity, so it never offered a split.
  expect(screen.queryByRole("button", { name: /Split into/ })).not.toBeInTheDocument();
});

test("items can be corrected, marked as taxed, removed and added", async () => {
  const rows = renderEditor();

  await userEvent.clear(screen.getByLabelText("Price of item 1"));
  await userEvent.type(screen.getByLabelText("Price of item 1"), "6.99");
  await userEvent.click(screen.getByLabelText("Item 1 is taxed"));
  expect(rows()[0]).toMatchObject({ price: "6.99", isTaxable: true });

  await userEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
  expect(rows().map((item) => item.name)).toEqual(["MILK"]);

  await userEvent.click(screen.getByRole("button", { name: "Add an item" }));
  expect(rows()).toHaveLength(2);
  expect(rows()[1]).toMatchObject({ name: "", price: "", sharedBy: [1, 2] });
});

test("the summary shows what the backend worked out", async () => {
  renderEditor();

  const summary = await screen.findByLabelText("Who pays what");

  expect(within(summary).getByText("$10.48")).toBeInTheDocument();
  expect(within(summary).getByText("$3.99")).toBeInTheDocument();
  expect(previewItemSplit).toHaveBeenLastCalledWith(
    [
      { name: "MILK", price: "6.49", is_taxable: false, shared_by: [1, 2] },
      { name: "YOGURT", price: "7.98", is_taxable: false, shared_by: [1, 2] },
    ],
    null,
    "14.47",
  );
});

test("the summary explains money that no item accounts for", async () => {
  vi.mocked(previewItemSplit).mockResolvedValue({ ...PREVIEW, difference: "0.40" });
  renderEditor("14.87");

  expect(await screen.findByText(/come to \$0.40 less than the total/)).toBeInTheDocument();
});

test("the summary waits until every item has someone and there is a total", async () => {
  renderEditor("");

  expect(screen.getByText("Enter the total to see what each person pays.")).toBeInTheDocument();
  expect(previewItemSplit).not.toHaveBeenCalled();
});

test("an item with nobody ticked is pointed out instead of a summary", async () => {
  renderEditor();

  await userEvent.click(screen.getByLabelText("Me shares item 1"));
  await userEvent.click(screen.getByLabelText("alex shares item 1"));

  expect(screen.getByText('Choose who "MILK" is for.')).toBeInTheDocument();
});

test("a problem reported by the backend is shown", async () => {
  vi.mocked(previewItemSplit).mockRejectedValue(
    new Error("someone would pay less than nothing; check who the discounts are assigned to"),
  );
  renderEditor();

  expect(await screen.findByRole("alert")).toHaveTextContent("less than nothing");
});
