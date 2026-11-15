import type { Metadata } from "next";
import { PortfolioClient } from "@/components/PortfolioClient";

export const metadata: Metadata = { title: "Portfolio triage · Unstuck" };

export default function Page() {
  return <PortfolioClient />;
}
