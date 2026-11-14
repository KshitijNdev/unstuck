import type { Metadata } from "next";
import { Fraunces, Geist_Mono, Instrument_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Fraunces({ variable: "--font-display", subsets: ["latin"] });
const body = Instrument_Sans({ variable: "--font-body", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Unstuck: accessibility screening",
  description:
    "Screens commercial properties for possible accessibility barriers and shows the evidence. Screening, not certification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-card focus:p-2">
          Skip to content
        </a>
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
              unstuck<span className="text-brand">.</span>
            </Link>
            <p className="text-sm text-muted">
              <strong className="text-ink">Screening, not certification.</strong>{" "}
              <span className="hidden sm:inline">Not a CASp/RAS inspection or legal determination.</span>
            </p>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
          Rules from the 2010 ADA Standards (ada.gov). Applicability, exceptions and state rules need professional review.
        </footer>
      </body>
    </html>
  );
}
