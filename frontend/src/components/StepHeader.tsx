/** The heading of a step, with a Back button. */
export default function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-lg hover:bg-zinc-200"
      >
        ←
      </button>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}
