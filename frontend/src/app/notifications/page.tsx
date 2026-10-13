import Notifications from "@/components/Notifications";

export default function NotificationsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <p className="mt-1 text-sm text-zinc-600">Money you received and answers to your requests.</p>

      <div className="mt-6">
        <Notifications />
      </div>
    </main>
  );
}
