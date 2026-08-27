import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/fyxx/primitives";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Report preview — Fyxx Marketing" },
      { name: "description", content: "Printable preview of the saved Fyxx monthly marketing report." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Report preview — Fyxx Marketing" },
      {
        property: "og:description",
        content: "Printable preview of the saved Fyxx monthly marketing report.",
      },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Report" subtitle="Placeholder — the printable layout will be built here." />
    </div>
  );
}
