import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { RotateCw } from "lucide-react";
import { useDateRange } from "@/context/date-range-context";
import { fetchLastSync } from "@/lib/queries";
import { PRESETS, rangeLabel } from "@/lib/ranges";
import { SUB_CHANNELS, describeChannels, posDefinitionWarning } from "@/lib/channels";
import { cn } from "@/lib/utils";

export function TopBar() {
  const { range, preset, setPreset, setCustom, refresh, refreshKey, channels, toggleChannel } = useDateRange();
  const posWarning = posDefinitionWarning(channels, range.from, range.to);
  const { data: sync } = useQuery({
    queryKey: ["sync_log", refreshKey],
    queryFn: fetchLastSync,
  });

  return (
    <header className="no-print border-b border-border bg-background">
      <div className="flex flex-wrap items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={cn(
                "label-xs rounded-sm border border-transparent px-3 py-1.5 text-muted-foreground hover:text-foreground",
                preset === p.key && "border-border bg-secondary text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === "custom" ? (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={range.from}
              onChange={(e) => setCustom({ ...range, from: e.target.value })}
              className="rounded-sm border border-input px-2 py-1"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setCustom({ ...range, to: e.target.value })}
              className="rounded-sm border border-input px-2 py-1"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{rangeLabel(range)}</p>
        )}

        <div className="ml-auto flex items-center gap-4">
          <p className="text-xs text-muted-foreground">
            Last updated{" "}
            {sync?.synced_at
              ? format(parseISO(sync.synced_at), "d MMM yyyy, HH:mm")
              : "—"}
          </p>
          <button
            onClick={refresh}
            className="label-xs flex items-center gap-2 rounded-sm border border-foreground px-3 py-1.5 hover:bg-secondary"
          >
            <RotateCw className="size-3" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-2">
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
        {/* Always rendered, including on first load. The default view hides
            roughly two thirds of revenue, so a figure must never be ambiguous
            about what it covers. */}
        <p className="text-xs text-muted-foreground">
          Showing <span className="text-foreground">{describeChannels(channels)}</span>
        </p>
      </div>

      {posWarning ? (
        <p className="border-t border-border bg-secondary/40 px-6 py-2 text-xs text-muted-foreground">
          ⚠️ {posWarning}
        </p>
      ) : null}
    </header>
  );
}
