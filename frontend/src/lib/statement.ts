// Helpers for downloading the monthly wallet statement.

/**
 * A month as the backend wants it, "2026-10", counted back from `today`.
 * `monthsAgo` 0 is this month, 1 is last month. In UTC, like the backend.
 */
export function statementMonth(today: Date, monthsAgo: number): string {
  // Date.UTC handles months below zero: month -1 of 2026 is December 2025.
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1));
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Save data the page already holds as a file on the user's device.
 *
 * A plain link to the backend would not work here: the download needs the
 * login cookie, and the backend is on another origin. So the page fetches
 * the file itself and then hands it to the browser through a temporary link.
 */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The temporary address keeps the data in memory until it is released.
  URL.revokeObjectURL(url);
}
