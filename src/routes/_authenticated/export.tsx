import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/context/date-range-context";
import { PageHeader, Panel, SectionLabel } from "@/components/fyxx/primitives";

export const Route = createFileRoute("/_authenticated/export")({
  head: () => ({
    meta: [
      { title: "Export report — Fyxx Marketing" },
      { name: "description", content: "Compose and save the monthly Fyxx marketing report." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Export report — Fyxx Marketing" },
      { property: "og:description", content: "Compose and save the monthly Fyxx marketing report." },
    ],
  }),
  component: ExportPage,
});

function ExportPage() {
  const navigate = useNavigate();
  const { range } = useDateRange();
  // Seeded from the global range and then FOLLOWS it. Previously these were
  // initial state only, so changing the preset while on this page left the
  // export covering a period the user was no longer looking at.
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [seeded, setSeeded] = useState(`${range.from}|${range.to}`);
  if (seeded !== `${range.from}|${range.to}`) {
    setSeeded(`${range.from}|${range.to}`);
    setFrom(range.from);
    setTo(range.to);
  }
  const [highlight, setHighlight] = useState("");
  const [bullets, setBullets] = useState(["", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const valid = highlight.trim().length > 0 && bullets.every((b) => b.trim().length > 0);

  const save = useMutation({
    mutationFn: async () => {
      // UPSERT, not insert. `reports` now carries a unique constraint on
      // (start_date, end_date) — added because saveNarrative on the report
      // page upserts against it and Postgres was rejecting that with 42P10,
      // so Save had never worked. A plain insert here would hit the same
      // constraint the second time a period is exported. Both pages write one
      // narrative per period, which is the intended shape.
      const { error: dbError } = await supabase.from("reports").upsert(
        {
          start_date: from,
          end_date: to,
          month_highlight: highlight.trim(),
          next_month_bullets: bullets.map((b) => b.trim()),
        },
        { onConflict: "start_date,end_date" },
      );
      if (dbError) throw new Error(dbError.message);
    },
    onSuccess: () => {
      setSaved(true);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const guard = () => {
    if (!valid) {
      setError("Add the month highlight and all three next month bullets.");
      return false;
    }
    return true;
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Export report" subtitle="Saved to the reports table, then previewed or printed." />

      <Panel title="Report details">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <SectionLabel>Start date</SectionLabel>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
            />
          </div>
          <div>
            <SectionLabel>End date</SectionLabel>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-6">
          <SectionLabel>Month highlight (two sentences, required)</SectionLabel>
          <textarea
            rows={3}
            required
            value={highlight}
            onChange={(e) => setHighlight(e.target.value)}
            className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-6 space-y-3">
          <SectionLabel>Next month — three bullets (all required)</SectionLabel>
          {bullets.map((b, i) => (
            <input
              key={i}
              required
              value={b}
              placeholder={`Bullet ${i + 1}`}
              onChange={(e) => setBullets(bullets.map((v, j) => (j === i ? e.target.value : v)))}
              className="w-full rounded-sm border border-input px-3 py-2 text-sm"
            />
          ))}
        </div>

        {error ? <p className="mt-4 text-xs text-destructive">{error}</p> : null}
        {saved ? <p className="mt-4 text-xs text-muted-foreground">Report saved.</p> : null}

        <div className="mt-8 flex flex-wrap gap-3 border-t border-border pt-6">
          <button
            onClick={() => {
              if (!guard()) return;
              save.mutate();
            }}
            className="label-xs rounded-sm border border-foreground px-4 py-2"
          >
            Save report
          </button>
          <button
            onClick={() => {
              if (!guard()) return;
              save.mutate(undefined, { onSuccess: () => navigate({ to: "/report" }) });
            }}
            className="label-xs rounded-sm bg-primary px-4 py-2 text-primary-foreground"
          >
            Preview
          </button>
          <button
            onClick={() => {
              if (!guard()) return;
              window.print();
            }}
            className="label-xs rounded-sm border border-foreground px-4 py-2"
          >
            Download PDF
          </button>
        </div>
      </Panel>
    </div>
  );
}
