import type { ExtractedItem } from "@/lib/api";
import { formatMoney } from "@/lib/format";

type ReceiptItemsProps = {
  items: ExtractedItem[];
  /** The receipt's currency, used to show the prices. */
  currency: string;
};

/** "Taxed", "Not taxed", or nothing when the receipt does not say. */
function taxLabel(isTaxable: boolean | null): string {
  if (isTaxable === null) {
    return "";
  }
  return isTaxable ? "Taxed" : "Not taxed";
}

/** The lines the AI read from a receipt, as a read-only table. */
export default function ReceiptItems({ items, currency }: ReceiptItemsProps) {
  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white shadow-sm p-5">
      <h3 className="text-sm font-semibold">Items ({items.length})</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Item</th>
              <th className="py-1 pr-3 text-right font-medium">Qty</th>
              <th className="py-1 pr-3 font-medium">Tax</th>
              <th className="py-1 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {items.map((item, position) => (
              // Two lines can be identical, so the position is part of the key.
              <tr key={`${position}-${item.name}`}>
                <td className="py-1 pr-3">{item.name}</td>
                <td className="py-1 pr-3 text-right">{item.quantity ?? ""}</td>
                <td className="py-1 pr-3 text-zinc-500">{taxLabel(item.is_taxable)}</td>
                <td className="whitespace-nowrap py-1 text-right">
                  {formatMoney(item.price, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
