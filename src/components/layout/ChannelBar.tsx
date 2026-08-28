import { useDateRange } from "@/context/date-range-context";
import { SUB_CHANNELS, describeChannels, posDefinitionWarning } from "@/lib/channels";
import { cn } from "@/lib/utils";

/**
 * Channel toggles.
 *
 * Rendered BY THE PAGES THAT HONOUR IT, not globally. It previously lived in
 * the top bar on every page while only the overview actually read the
 * selection — so on nine pages you could click these and nothing happened,
 * which reads as broken software rather than as a control that does not apply.
 */
export function ChannelBar() {
  const { range, channels, toggleChannel } = useDateRange();
  const posWarning = posDefinitionWarning(channels, range.from, range.to);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="label-xs text-muted-foreground">Channels</span>
        <div className="flex flex-wrap items-center gap-1">
          {SUB_CHANNELS.map((c) => {
            const on = channels.includes(c);
            return (
              <button
                key={c}
                onClick={() => toggleChannel(c)}
                aria-pressed={on}
                className={cn(
                  "label-xs rounded-sm border px-3 py-1",
                  on
                    ? "border-foreground bg-secondary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
        {/* Unconditional: the default hides roughly two thirds of revenue, so a
            figure must never be ambiguous about what it covers. */}
        <p className="text-xs text-muted-foreground">
          Showing <span className="text-foreground">{describeChannels(channels)}</span>
        </p>
      </div>
      {posWarning ? (
        <p className="border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          ⚠️ {posWarning}
        </p>
      ) : null}
    </div>
  );
}
