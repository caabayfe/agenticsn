# 0048. `--demo` is the one demo switch: demo data, demo modules and store applications' demo data

- Status: Accepted (product owner, 2026-11-03: "I would like to enable the capability to install
  the store app demo data consistently, as it is really helpful"). Asked for in these words: "if we use --demodata (or
  something similar) it installs demo data, so I am happy with data, we need a lot of data to be
  able to have a good story" (zero-touch pack, decision D2); and "the profile should be the same,
  if it says --demo it should go with the demo approach, otherwise it is just too many options"
- Date: 2026-11-03
- Requirements: G1, ASR-08, ASR-15
- Amends, when accepted: 0038, section 4 ("Demo data is never loaded")
- Relates to: 0012 (only development instances are written), 0026 (the pack's own demo data,
  `--demo`), spec 011 (I3, the store application installer)

## Context

ADR-0038 installs a module's platform components through the platform's installer and never
loads their demo data: a component installed for a customer must not bring fictional records
into their instance, and components reach test and production at parity with development.

The zero-touch pack (`ntt-accelerators/packs/zero-touch`) shows ServiceNow's Zero Touch Support.
One of its use cases, Digital End-user Experience (DEX), has no story without devices,
application health and scores, and only ServiceNow's demo data supplies them on an instance
without endpoint agents:

- the store application `sn_dex_demo_data`;
- the DEX install's "Load demo data" option, which exists only at install time: the content
  playbook's demo data cannot be loaded later.

The CI/CD API takes the choice per install: `POST /api/sn_cicd/app_repo/install` with
`load_demo_data` (snagentic sends `false` today). `accelerator install --demo` already exists, for
the pack's own fictional data (ADR-0026). The store marks very few applications as having demo
data (everis2, 2026-11-03: `demo_data` is `no_demo_data` on all 3,168 store rows, DEX included),
so the store's flag cannot be relied on to say what loading it brings.

## Decision

1. **A component may declare demo data:** `{ kind: app, id, minVersion, entitlement, demoData:
   true }` in `module.yaml`.
2. **The same switch as the pack's own demo data.** `accelerator install` already takes either
   `--demo` (the pack's fictional data) or `--data <directory>` (a customer's). With `--demo`, on a
   development instance, the components that declare demo data install with
   `load_demo_data=true`. With `--data`, every component installs as today, with
   `load_demo_data=false`.
3. **Demo modules are part of the normal profiles, marked `demo: true`** in `module.yaml`. One
   profile serves both installs: with `--demo` the plan includes them; with `--data` it leaves them
   out and lists them as "demo only, left out". There is no separate demo profile. Naming a demo
   module with `--modules` without `--demo` is a problem that stops the plan. A demo-only
   application (`sn_dex_demo_data`) is a component of a demo module (`zt-dex-demo`), not a new kind
   of component. Their loaders stay behind a property that is off as installed (as the itsm pack's
   `demo-history` and `demo-scenarios`).
4. **The plan says so.** The install document lists, per component, whether its demo data loads,
   and states that the platform's demo data cannot be removed by snagentic. The choice is part of
   the plan id.
5. **Never at parity.** Demo data loads only on a development instance: a plan for another kind
   never marks a component for it. The component installer for test and production (ADR-0038,
   section 5, not built yet) must install without demo data and without demo modules' components,
   whatever the development install did.
6. **An application already installed** cannot load its demo data any more (the platform offers
   it only at install time): with `--demo`, the plan warns, and installs nothing again.
7. **`apps install`** takes `--demo-data` for the same choice, on development instances only.

## Consequences

- A demo instance can be rebuilt from git with the story's data, as the owner asked.
- The pack author decides which components bring demo data; the store's flag is not trusted.
- Demo data loaded by the platform is not the pack's: re-running the install does not reload it,
  and removing it is the platform's (Application Manager), not snagentic's.
- One command per install kind: `--profile zero-touch --demo` for a demo, `--profile zero-touch
  --data <directory>` for a customer. No demo profiles to keep in step with the real ones.
- New work in snagentic: the two manifest fields (`demoData` on a component, `demo` on a
  module), the planning rules, the document lines, the installer's parameter, and the parity
  rule's exclusion, with tests for each.
- The itsm pack can move `demo-history` and `demo-scenarios` into its profiles with `demo: true`
  (a pack change, optional); installed by name, as today, they keep working with `--demo`.

## Alternatives considered

- **Never load component demo data (ADR-0038 as it stands).** Rejected by the owner for demo
  instances: the DEX story is not possible without it.
- **Load it whenever the store marks an application as having demo data.** Rejected: the store
  marks none, DEX included.
- **Separate demo profiles** (`zero-touch-demo`). Rejected by the owner: two profiles per pack to
  keep in step, and one more option to choose.
- **A manual step outside the pack.** Rejected: the owner wants the demo instance rebuilt from git
  without steps a person must remember.
