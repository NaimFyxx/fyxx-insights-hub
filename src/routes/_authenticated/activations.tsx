import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchActivations, type Activation } from "@/lib/queries";
import { PageHeader, Panel, EmptyState, SectionLabel, QueryFailed } from "@/components/fyxx/primitives";
import { useDateRange } from "@/context/date-range-context";

export const Route = createFileRoute("/_authenticated/activations")({
  head: () => ({
    meta: [
      { title: "Activations — Fyxx Marketing" },
      { name: "description", content: "Planned and completed Fyxx in-store and event activations." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Activations — Fyxx Marketing" },
      {
        property: "og:description",
        content: "Planned and completed Fyxx in-store and event activations.",
      },
    ],
  }),
  component: ActivationsPage,
});

const STATUSES = ["Planned", "Done", "Not done"] as const;

type Draft = { id?: string; title: string; date: string; status: string; notes: string };

const emptyDraft = (): Draft => ({
  title: "",
  date: format(new Date(), "yyyy-MM-dd"),
  status: "Planned",
  notes: "",
});

function ActivationsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState<string>("all");
  const [draft, setDraft] = useState<Draft | null>(null);

  const { refreshKey } = useDateRange();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["activations", refreshKey],
    queryFn: fetchActivations,
  });

  const months = useMemo(() => {
    const set = new Set((data ?? []).map((a) => a.date.slice(0, 7)));
    return [...set].sort();
  }, [data]);

  const rows = useMemo(
    () => (data ?? []).filter((a) => month === "all" || a.date.startsWith(month)),
    [data, month],
  );

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = { title: d.title, date: d.date, status: d.status, notes: d.notes || null };
      const res = d.id
        ? await supabase.from("activations").update(payload).eq("id", d.id)
        : await supabase.from("activations").insert(payload);
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["activations"] }); // prefix match, survives refreshKey
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("activations").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activations"] }),
  });

  const startEdit = (a: Activation) =>
    setDraft({ id: a.id, title: a.title, date: a.date, status: a.status, notes: a.notes ?? "" });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Activations"
        subtitle="In-store and event calendar. Filtered by its own month picker, not the date range above."
      />
      {isError ? <QueryFailed error={error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <SectionLabel>Month</SectionLabel>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-sm border border-input px-2 py-1.5 text-sm"
        >
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {format(parseISO(`${m}-01`), "MMMM yyyy")}
            </option>
          ))}
        </select>
        <button
          onClick={() => setDraft(emptyDraft())}
          className="label-xs ml-auto rounded-sm bg-primary px-4 py-2 text-primary-foreground"
        >
          Add activation
        </button>
      </div>

      {draft ? (
        <Panel title={draft.id ? "Edit activation" : "New activation"}>
          <form
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <div>
              <SectionLabel>Title</SectionLabel>
              <input
                required
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
              />
            </div>
            <div>
              <SectionLabel>Date</SectionLabel>
              <input
                type="date"
                required
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
              />
            </div>
            <div>
              <SectionLabel>Status</SectionLabel>
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
              >
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <SectionLabel>Notes</SectionLabel>
              <textarea
                rows={3}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <button
                type="submit"
                disabled={save.isPending}
                className="label-xs rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="label-xs rounded-sm border border-foreground px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel title="Calendar list">
        {isError ? (
          <EmptyState>Not loaded — see the error above.</EmptyState>
        ) : isLoading ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No activations for this month.</EmptyState>
        ) : (
          <ul>
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-4 border-b border-border py-4 last:border-b-0">
                <div className="w-24 shrink-0">
                  <p className="display-num text-xl">{format(parseISO(a.date), "d MMM")}</p>
                  <p className="text-xs text-muted-foreground">{format(parseISO(a.date), "yyyy")}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.title}</p>
                  {a.notes ? <p className="mt-1 text-xs text-muted-foreground">{a.notes}</p> : null}
                </div>
                <span className="label-xs h-fit rounded-sm bg-secondary px-2 py-1">{a.status}</span>
                <div className="flex h-fit gap-3">
                  <button onClick={() => startEdit(a)} className="label-xs text-muted-foreground hover:text-foreground">
                    Edit
                  </button>
                  <button
                    onClick={() => remove.mutate(a.id)}
                    className="label-xs text-muted-foreground hover:text-destructive"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
