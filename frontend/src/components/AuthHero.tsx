/** The green card at the top of the log-in and sign-up pages: what the app is, in one line. */
export default function AuthHero() {
  return (
    <section className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg">
      <p className="text-2xl font-semibold tracking-tight">SplitPay</p>
      <p className="mt-1 text-sm text-emerald-100">
        Scan a receipt, split the bill with your roommates, and pay them back from your wallet.
      </p>
    </section>
  );
}
