import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("label-xs text-muted-foreground", className)}>{children}</p>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="border-b border-border pb-4">
      <h1 className="font-heading text-3xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-card", className)}>
      {title ? (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <SectionLabel>{title}</SectionLabel>
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Delta({ value, suffix = "vs previous period" }: { value: number; suffix?: string }) {
  const sign = value > 0 ? "+" : "";
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="text-foreground">
        {sign}
        {value.toFixed(1)}%
      </span>{" "}
      {suffix}
    </p>
  );
}

export function StatTile({
  label,
  value,
  delta,
  note,
}: {
  label: string;
  value: string;
  delta?: number | null | undefined;
  note?: string;
}) {
  return (
    <div className="border-t border-border pt-4">
      <SectionLabel>{label}</SectionLabel>
      <p className="display-num mt-3 text-4xl leading-none">{value}</p>
      {typeof delta === "number" ? (
        <Delta value={delta} />
      ) : delta === null ? (
        // Null means no prior period to compare against — say so rather than
        // showing a percentage that was never measured.
        <p className="mt-2 text-xs text-muted-foreground">no comparison</p>
      ) : null}
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/**
 * A query that FAILED, rendered as a failure.
 *
 * Every page used to fall back to `data ?? []` or `isLoading || !data`, so an
 * error appeared either as "No campaigns in range." — a confident factual claim
 * manufactured by a network error — or as "Loading…" forever. Both are worse
 * than an error, because both look like answers.
 */
export function QueryFailed({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="border border-destructive/40 bg-destructive/5 px-4 py-3">
      <p className="text-sm text-destructive">This could not be loaded, so nothing below is a real figure.</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * The line that sits on every revenue figure.
 *
 * Not a README footnote: Naim's point is that an exclusion nobody can see is
 * indistinguishable from a wrong number, and this dashboard's revenue is ~6%
 * below Shopify's own total. Anyone comparing the two needs to meet that fact
 * at the figure, not go looking for it.
 */
export function ExcludesHouseAccounts({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      Revenue excludes internal accounts — venue tables, staff and write-offs.{" "}
      <a href="/excluded" className="underline">
        See what is excluded
      </a>
      .
    </p>
  );
}

/**
 * The caveat that must sit beside every open figure.
 *
 * Its absence was the largest unlabelled distortion in the dashboard: opens
 * appeared on four surfaces including the monthly report to Zeid, with nothing
 * saying that Apple Mail fires the open pixel by pre-fetching images.
 */
export function OpensCaveat({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      ⚠️ <b>Opens are not readers.</b> Apple Mail pre-fetches images and marks a message opened
      whether or not anyone read it, so opens and open rates are inflated by an unknown amount —
      and are <b>not comparable across time</b>, because the inflation grows with Apple&rsquo;s
      share of the list. Judge a campaign on clicks, orders and revenue instead.
    </p>
  );
}
