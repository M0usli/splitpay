import Link from "next/link";

const links = [
  { href: "/", label: "Upload" },
  { href: "/expenses", label: "Expenses" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/expenses/new", label: "Add expense" },
];

export default function NavBar() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <nav className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-6 gap-y-1 px-6 py-3">
        <Link href="/" className="whitespace-nowrap font-semibold tracking-tight">
          Receipt Tracker
        </Link>
        <ul className="flex gap-4 whitespace-nowrap text-sm text-zinc-600">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:text-zinc-900">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
