import type { DailySales } from "@/lib/queries";
import { worstConcentration, type Granularity } from "@/lib/timeseries";

/**
 * Warns when a small number of orders carried a channel's revenue.
 *
 * A bulk buyer — a venue ordering cases — looks identical to demand in any
 * revenue total. This names the number of orders behind the figure so it
 * cannot be read as growth. Shown wherever a channel figure is, not only on
 * the Online page, because Draft Orders is where the bulk buying actually
 * lives and a single 3,364 JOD order most distorts a weekly number there.
 */
export function ConcentrationNotice({
  rows,
  channels,
  granularity = "weekly",
}: {
  rows: DailySales[];
  channels: readonly string[];
  granularity?: Granularity;
}) {
  const findings = channels
    .map((ch) => ({ ch, w: worstConcentration(rows, ch, granularity) }))
    .filter((f) => f.w !== null);

  if (!findings.length) return null;

  return (
    <div className="border-l-2 border-border bg-secondary/30 px-4 py-3">
      <p className="label-xs mb-1 text-muted-foreground">Concentration</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {findings.map((f) => (
          <li key={f.ch}>
            <span className="text-foreground">{f.w!.bucket}</span> — {f.w!.c.note}
          </li>
        ))}
      </ul>
    </div>
  );
}
