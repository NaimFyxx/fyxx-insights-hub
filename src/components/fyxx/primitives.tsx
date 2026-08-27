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
  delta?: number;
  note?: string;
}) {
  return (
    <div className="border-t border-border pt-4">
      <SectionLabel>{label}</SectionLabel>
      <p className="display-num mt-3 text-4xl leading-none">{value}</p>
      {typeof delta === "number" ? <Delta value={delta} /> : null}
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
