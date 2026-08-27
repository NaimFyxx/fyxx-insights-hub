import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  onClick,
  active,
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "label-xs border-b border-border py-2 text-muted-foreground",
        align === "right" ? "text-right" : "text-left",
        onClick && "cursor-pointer select-none hover:text-foreground",
        active && "text-foreground",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-border py-2.5 align-top",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function TotalsRow({ children }: { children: ReactNode }) {
  return <tr className="bg-secondary/60 font-medium">{children}</tr>;
}
