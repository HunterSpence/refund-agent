import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Refund Agent — AI Support",
  description:
    "Policy-governed refund agent with live reasoning dashboard. " +
    "Every decision is traceable: CRM lookup → policy check → deterministic outcome.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
       * Force dark color-scheme at the HTML level.
       * This ensures system-UI chrome, scrollbars, and form controls
       * match the dark mission-control aesthetic.
       */}
      <body className="h-full flex flex-col bg-[var(--color-surface-base)] text-[var(--color-text-primary)]">
        {children}
      </body>
    </html>
  );
}
