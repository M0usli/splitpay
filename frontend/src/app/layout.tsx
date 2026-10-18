import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import AuthProvider from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
import RequireLogin from "@/components/RequireLogin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SplitPay",
  description: "A wallet for sending money and splitting bills, with receipt scanning",
  // The icon an iPhone uses when the site is added to the home screen.
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // The colour of the phone's status bar around the page.
  themeColor: "#18181b",
};

function LoadingPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <p className="text-sm text-zinc-500">Loading…</p>
    </main>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <NavBar />
          {/* RequireLogin reads the address, which is only known when a request
              arrives. Suspense lets the rest of the page be prepared ahead of
              time; without it the production build refuses to prerender. */}
          <Suspense fallback={<LoadingPage />}>
            <RequireLogin>{children}</RequireLogin>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
