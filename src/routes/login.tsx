import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Fyxx Marketing" },
      { name: "description", content: "Internal Fyxx marketing dashboard sign in." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Sign in — Fyxx Marketing" },
      { property: "og:description", content: "Internal Fyxx marketing dashboard sign in." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate({ to: "/overview" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <p className="font-heading text-4xl leading-none">Fyxx</p>
        <p className="label-xs mt-3 text-muted-foreground">Marketing dashboard</p>

        <form onSubmit={onSubmit} className="mt-8 border-t border-border pt-6">
          <label className="label-xs text-muted-foreground" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm outline-none focus:border-foreground"
          />

          <label className="label-xs mt-5 block text-muted-foreground" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-sm border border-input px-3 py-2 text-sm outline-none focus:border-foreground"
          />

          {error ? <p className="mt-4 text-xs text-destructive">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="label-xs mt-6 w-full rounded-sm bg-primary px-4 py-3 text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-xs text-muted-foreground">
          Accounts are created by an administrator. There is no public sign up.
        </p>
      </div>
    </div>
  );
}
