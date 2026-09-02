import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // networkMode "always" is the difference between an error and a hung page.
  //
  // React Query's default is "online": when a fetch fails in a way that looks
  // like the network is down, it PAUSES the query instead of failing it. A
  // paused query reports status "pending", fetchStatus "paused", isError
  // FALSE and isLoading FALSE — so an error branch never runs, an
  // `isLoading || !data` guard sits on "Loading…" forever, and a panel keyed
  // off `rows.length` renders its empty state as though the answer were zero.
  //
  // Verified in the live app on 2 September 2026: blocking Supabase requests
  // left every page either spinning indefinitely or showing "No campaigns in
  // range." on a month that has eight campaigns. The same block delivered as
  // an HTTP 500 produced the error box correctly, which is what proved the
  // fault was the pause and not the error handling.
  //
  // "always" makes a dead network fail like any other error, which is what a
  // dashboard wants: a stated failure beats a spinner that never resolves.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { networkMode: "always" } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
