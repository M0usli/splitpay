// The same email always gets the same colour.
const COLOURS = [
  "bg-violet-100 text-violet-700",
  "bg-lime-100 text-lime-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
];

type AvatarProps = {
  email: string;
  /** Tailwind classes for the circle's size and letter size. */
  size?: string;
};

/** A coloured circle with the person's first letter. */
export default function Avatar({ email, size = "h-11 w-11 text-base" }: AvatarProps) {
  const index = [...email].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % COLOURS.length;
  return (
    <span
      aria-hidden
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-semibold uppercase ${COLOURS[index]}`}
    >
      {email[0]}
    </span>
  );
}
