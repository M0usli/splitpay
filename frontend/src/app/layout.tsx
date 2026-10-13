import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <NavBar />
          <RequireLogin>{children}</RequireLogin>
        </AuthProvider>
      </body>
    </html>
  );
}
