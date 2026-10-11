import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import SharingFields from "@/components/SharingFields";
import type { Member } from "@/lib/api";
import { NOT_SHARED, type SharingValues } from "@/lib/split";

const MEMBERS: Member[] = [
  { id: 1, email: "sam@example.com" },
  { id: 2, email: "alex@example.com" },
  { id: 3, email: "jo@example.com" },
];

/** Renders the fields with real state, and reports every change to `onChange`. */
function renderFields(initial: SharingValues = NOT_SHARED) {
  const onChange = vi.fn();
  function Wrapper() {
    const [value, setValue] = useState(initial);
    return (
      <SharingFields
        members={MEMBERS}
        myId={1}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Wrapper />);
  return onChange;
}

test("starts with only the share tick box", () => {
  renderFields();

  expect(screen.getByLabelText("Share this expense with my household")).not.toBeChecked();
  expect(screen.queryByLabelText("Equally")).not.toBeInTheDocument();
});

test("turning sharing on picks everyone, split equally", async () => {
  const onChange = renderFields();

  await userEvent.click(screen.getByLabelText("Share this expense with my household"));

  expect(onChange).toHaveBeenLastCalledWith({
    isShared: true,
    mode: "equal",
    included: [1, 2, 3],
    inputs: {},
  });
  expect(screen.getByLabelText("Equally")).toBeChecked();
  expect(screen.getByLabelText("Me (sam@example.com)")).toBeChecked();
  expect(screen.getByLabelText("jo@example.com")).toBeChecked();
});

test("a person can be left out", async () => {
  const onChange = renderFields({ isShared: true, mode: "equal", included: [1, 2, 3], inputs: {} });

  await userEvent.click(screen.getByLabelText("jo@example.com"));

  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ included: [1, 2] }));
});

test("splitting by amount shows an input for each person ticked", async () => {
  const onChange = renderFields({ isShared: true, mode: "equal", included: [1, 2], inputs: {} });

  await userEvent.click(screen.getByLabelText("By amount"));
  await userEvent.type(screen.getByLabelText("Amount for alex@example.com"), "31.15");

  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: "amount", inputs: { 2: "31.15" } }),
  );
  // Jo is not ticked, so there is no input for Jo.
  expect(screen.queryByLabelText("Amount for jo@example.com")).not.toBeInTheDocument();
});

test("splitting by percent labels the inputs as percents", async () => {
  renderFields({ isShared: true, mode: "equal", included: [1, 2], inputs: {} });

  await userEvent.click(screen.getByLabelText("By percent"));

  expect(screen.getByLabelText("Percent for Me (sam@example.com)")).toBeInTheDocument();
});
