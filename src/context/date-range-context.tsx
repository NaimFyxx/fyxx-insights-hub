import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { presetRange, type DateRange, type PresetKey } from "@/lib/ranges";

type Ctx = {
  range: DateRange;
  preset: PresetKey;
  setPreset: (p: PresetKey) => void;
  setCustom: (r: DateRange) => void;
  refreshKey: number;
  refresh: () => void;
};

const DateRangeContext = createContext<Ctx | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetState] = useState<PresetKey>("this_month");
  const [range, setRange] = useState<DateRange>(() => presetRange("this_month"));
  const [refreshKey, setRefreshKey] = useState(0);

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
    }),
    [range, preset, refreshKey],
  );

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used inside DateRangeProvider");
  return ctx;
}
