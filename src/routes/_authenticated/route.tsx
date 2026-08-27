import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { DateRangeProvider } from "@/context/date-range-context";

// TEMPORARY (build phase only): auto sign-in so we never hit the login screen.
// Remove DEV_AUTO_LOGIN + the auto sign-in block before handing the dashboard over.
const DEV_AUTO_LOGIN = {
  email: "n.aljada@myfyxx.com",
  password: "FyxxBuild2026!",
};

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let { data } = await supabase.auth.getUser();
    if (!data.user && DEV_AUTO_LOGIN) {
      await supabase.auth.signInWithPassword(DEV_AUTO_LOGIN);
      data = (await supabase.auth.getUser()).data;
    }
    if (!data.user) throw redirect({ to: "/login" });
    return { user: data.user };
  },
  component: AppShell,
});


function AppShell() {
  return (
    <DateRangeProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-w-0 flex-1 px-6 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </DateRangeProvider>
  );
}
