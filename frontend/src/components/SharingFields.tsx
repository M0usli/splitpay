"use client";

import type { Member } from "@/lib/api";
import type { SharingValues, SplitMode } from "@/lib/split";

type SharingFieldsProps = {
  members: Member[];
  /** The logged-in user's id, shown as "Me". */
  myId: number;
  value: SharingValues;
  onChange: (value: SharingValues) => void;
};

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: "equal", label: "Equally" },
  { mode: "percent", label: "By percent" },
  { mode: "amount", label: "By amount" },
  { mode: "item", label: "By item" },
];

const smallInputClass =
  "w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";

/** The part of the expense form that says who shares an expense and how. */
export default function SharingFields({ members, myId, value, onChange }: SharingFieldsProps) {
  const allIds = members.map((member) => member.id);

  function toggleShared(isShared: boolean) {
    // Turning sharing on starts with the simplest choice: everyone, equally.
    onChange(isShared ? { isShared: true, mode: "equal", included: allIds, inputs: {} } : { ...value, isShared: false });
  }

  function toggleMember(id: number, isIncluded: boolean) {
    const included = isIncluded
      ? [...value.included, id]
      : value.included.filter((memberId) => memberId !== id);
    onChange({ ...value, included });
  }

  function setInput(id: number, text: string) {
    onChange({ ...value, inputs: { ...value.inputs, [id]: text } });
  }

  return (
    <fieldset className="rounded-md border border-zinc-200 p-3">
      <legend className="px-1 text-sm font-medium text-zinc-700">Sharing</legend>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.isShared}
          onChange={(event) => toggleShared(event.target.checked)}
        />
        Share this expense with my household
      </label>

      {value.isShared && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="How to split">
            {MODES.map(({ mode, label }) => (
              <label key={mode} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="split-mode"
                  checked={value.mode === mode}
                  onChange={() => onChange({ ...value, mode, inputs: {} })}
                />
                {label}
              </label>
            ))}
          </div>

          {/* By item, people are chosen per item in the editor below the form's
              sharing section, so the list of people is not shown here. */}
          <ul className="space-y-2" hidden={value.mode === "item"}>
            {members.map((member) => {
              const isIncluded = value.included.includes(member.id);
              const name = member.id === myId ? `Me (${member.email})` : member.email;
              return (
                <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isIncluded}
                      onChange={(event) => toggleMember(member.id, event.target.checked)}
                    />
                    <span className="truncate">{name}</span>
                  </label>
                  {value.mode !== "equal" && isIncluded && (
                    <span className="flex items-center gap-1 text-zinc-500">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${value.mode === "percent" ? "Percent" : "Amount"} for ${name}`}
                        value={value.inputs[member.id] ?? ""}
                        onChange={(event) => setInput(member.id, event.target.value)}
                        className={smallInputClass}
                      />
                      {value.mode === "percent" ? "%" : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-zinc-500">
            {value.mode === "equal" && "The total is divided equally among the people ticked."}
            {value.mode === "percent" && "The percents must add up to 100."}
            {value.mode === "amount" && "The amounts must add up to the total."}
            {value.mode === "item" && "Choose who each item is for. Tax follows the taxed items."}
          </p>
        </div>
      )}
    </fieldset>
  );
}
