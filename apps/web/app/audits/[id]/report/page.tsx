import { Suspense } from "react";
import { ReportClient } from "@/components/ReportClient";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportClient id={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Content params={params} />
    </Suspense>
  );
}
