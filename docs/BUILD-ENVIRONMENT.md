# Build environment: known conditions

Recorded 2 September 2026 so these are not rediscovered later as mysteries.
Everything here is a checked fact, not a recollection.

## Two lockfiles are tracked, for two different package managers

    bun.lock            added 2026-08-20 in the Lovable template commit
    package-lock.json   added 2026-08-30

Both are committed. That is worth knowing, because it means dependency
resolution depends on which tool runs the build:

- `bun install` reads `bun.lock` and ignores `package-lock.json`
- `npm install` or `npm ci` reads `package-lock.json` and ignores `bun.lock`

Whichever one is not used goes stale silently. Two lockfiles disagreeing is a
harder problem to spot than none at all, because both look authoritative.

`bun.lock` arriving in the Lovable scaffold commit is the strongest available
signal that **Lovable's pipeline uses bun**. That has not been confirmed with
Lovable directly. If it does use bun, `package-lock.json` pins nothing for
Lovable builds and only pins local and CI installs that use npm.

**Worth resolving deliberately rather than by drift.** Pick the package manager
the build actually uses, keep that lockfile, and delete the other. Until then,
regenerate whichever one you changed and commit both together.

Nothing here is ignored: `.gitignore` has never listed either lockfile.

## Node version: packages want newer than we run

Install prints engine warnings. They are accurate:

    @tanstack/react-start   requires >=22.12.0
    @tanstack/history       requires >=20.19
    @tanstack/react-router  requires >=20.19
    local machine            v20.20.2

So `react-start` wants Node 22.12 or newer and the machine runs 20.20.2.
**Everything works today.** Vite build succeeds, the dev server runs, and the
sync scripts run.

**Do not upgrade Node to silence these.** They are warnings, not errors, and
the upgrade is a change to the runtime under a working application for no
observed benefit. Revisit only if something actually breaks and the version is
the demonstrated cause.

One knock-on that is already handled: `@supabase/supabase-js` needs a native
`WebSocket`, which Node 20 lacks, so it throws on import in Node. This is why
`scripts/lib/db.mjs` talks to PostgREST over plain `fetch` instead of using
that client. That is deliberate, documented in the file, and should stay that
way while Node is 20.

## npm audit: do not run `npm audit fix`

As at 2 September 2026 the audit reports **2 moderate** advisories and nothing
higher. No critical, no high.

A forced fix pulls breaking major upgrades into a working dependency set to
resolve advisories that are moderate and mostly reached only through dev
tooling. The cost is higher than the risk. Leave it.

If the count rises or anything reaches high or critical, reassess then, package
by package, rather than with `--force`.

## Running the tests

There is no `npm test` script. The command is:

    npm run test:sync

It runs five files and, as at this date, **220 passing checks**:

    sync.test.mjs               128
    timeseries.test.mjs          36
    shopify-readonly.test.mjs    27
    shopify-auth.test.mjs        15
    shopify-install.test.mjs     14

These are plain Node scripts with no test framework and no runtime
dependencies, which is why they run anywhere Node runs.
