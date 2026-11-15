import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Unstuck: accessibility screening",
  description:
    "Screens commercial properties for possible accessibility barriers and shows the evidence. Screening, not certification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-sheet focus:p-2">
          Skip to content
        </a>
        <header className="no-print sticky top-0 z-30 border-b border-line bg-concrete/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-3">
            <Link href="/" className="flex items-center gap-2.5" aria-label="Unstuck home">
              <Mark />
              <span className="font-display text-[1.65rem] font-bold leading-none">unstuck</span>
            </Link>
            <nav aria-label="Main" className="flex items-center gap-5 text-[0.95rem]">
              <Link href="/#how" className="hidden font-medium hover:underline sm:inline">How it works</Link>
              <Link href="/#agent" className="hidden font-medium hover:underline sm:inline">The agent</Link>
              <Link href="/#screen" className="btn btn-primary btn-sm">Screen a building</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="w-full flex-1">
          <Providers>{children}</Providers>
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-2 px-5 py-6 text-sm text-muted sm:grid-cols-2">
            <p>
              <strong className="text-ink">Screening, not certification.</strong> Unstuck is not a CASp or RAS inspection
              or a legal determination.
            </p>
            <p className="sm:text-right">
              Thresholds from the 2010 ADA Standards. Applicability, exceptions and state rules need professional review.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

/** A painted parking bay with its hatched aisle: the product's mark. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect x="1" y="1" width="14" height="24" fill="var(--sign)" />
      <path d="M17 1v24M25 1v24" stroke="var(--sign)" strokeWidth="2" />
      <path d="M17 7l8-6M17 14l8-6M17 21l8-6" stroke="var(--sign)" strokeWidth="1.6" />
    </svg>
  );
}
