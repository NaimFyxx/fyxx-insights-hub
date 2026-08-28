import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { to: "/overview", label: "Overview" },
  { to: "/online", label: "Online channels" },
  { to: "/campaigns", label: "Email campaigns" },
  { to: "/flows", label: "Flows" },
  { to: "/push", label: "Push" },
  { to: "/loyalty", label: "Loyalty" },
  { to: "/activations", label: "Activations" },
  { to: "/export", label: "Export report" },
  { to: "/health", label: "Sync health" },
] as const;

export function Sidebar() {
  return (
    <aside className="no-print flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border px-5 py-6">
        <p className="font-heading text-2xl leading-none">Fyxx</p>
        <p className="label-xs mt-2 text-muted-foreground">Marketing</p>
      </div>
      <nav className="flex flex-1 flex-col py-2">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="label-xs border-l-2 border-transparent px-5 py-3 text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{
              className:
                "label-xs border-l-2 border-accent bg-secondary px-5 py-3 text-foreground",
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <button
        onClick={() => supabase.auth.signOut()}
        className="label-xs border-t border-border px-5 py-4 text-left text-muted-foreground hover:text-foreground"
      >
        Sign out
      </button>
    </aside>
  );
}
