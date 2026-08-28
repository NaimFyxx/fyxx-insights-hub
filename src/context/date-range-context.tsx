import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { presetRange, type DateRange, type PresetKey } from "@/lib/ranges";
import { DEFAULT_CHANNELS, type SubChannel } from "@/lib/channels";

type Ctx = {
  range: DateRange;
  preset: PresetKey;
  setPreset: (p: PresetKey) => void;
  setCustom: (r: DateRange) => void;
  refreshKey: number;
  refresh: () => void;
  /** Selected sales channels. Never empty — deselecting the last is ignored. */
  channels: SubChannel[];
  toggleChannel: (c: SubChannel) => void;
};

const DateRangeContext = createContext<Ctx | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetState] = useState<PresetKey>("this_month");
  const [range, setRange] = useState<DateRange>(() => presetRange("this_month"));
  const [refreshKey, setRefreshKey] = useState(0);
  const [channels, setChannels] = useState<SubChannel[]>(DEFAULT_CHANNELS);

  const value = useMemo<Ctx>(
    () => ({
      range,
      preset,
      setPreset: (p) => {
        setPresetState(p);
        if (p !== "custom") setRange(presetRange(p));
      },
      setCustom: (r) => {
        setPresetState("custom");
        setRange(r);
      },
      refreshKey,
      refresh: () => setRefreshKey((k) => k + 1),
      channels,
      toggleChannel: (c) =>
        setChannels((cur) => {
          const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
          // An empty selection would render "0 JOD" with no explanation, which
          // reads as a broken dashboard rather than an empty filter.
          return next.length ? next : cur;
        }),
    }),
    [range, preset, refreshKey, channels],
  );

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used inside DateRangeProvider");
  return ctx;
}
