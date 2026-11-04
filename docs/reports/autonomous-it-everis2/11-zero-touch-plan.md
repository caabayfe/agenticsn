# Zero Touch on everis2

ServiceNow's Zero Touch Support (accelerated resolution, proactive deflection, omni-channel) is
built as an accelerator pack, **zero-touch**, so it installs again on any instance from git. The
plan is in the accelerators repository: `ntt-accelerators/packs/zero-touch/plans/zero-touch.md`.

Owner's decisions (3 November 2026):

- the pack installs **in isolation**, with its own fictional company, and acts only on that
  company's records;
- `--demo` installs demo data, including the store applications' own (DEX);
- it is built and tested on everis2, because these features are not available on PDIs.

## What it means for this route

The scenes in [09-demo-route.md](09-demo-route.md) stay as they are, on the `DEMO.PI` groups and
the Analista AIT persona. The Zero Touch scenes run on the pack's company, and are added to the
storyline as each pack stage passes its gate:

| Pack stage | Scene | Where in the storyline |
|---|---|---|
| S1 outage deflection | A known outage answered in chat, no ticket | Act 1, after 1.3 |
| S2 L1 AI Specialist | The ticket nobody touched, and the P1 it hands over | Act 2, before 2.1 |
| S3 scorecard | Tickets nobody touched, against the baseline | Act 4, before 4.1 |
| S4 voice | Account unlock by voice | Act 1, first |
| S5 DEX | The laptop fixed before the call | Act 1, after the voice scene |

After every stage, a full run of this route must give the 30 October results. A Zero Touch
install never changes a `DEMO.PI` record.

## everis2 facts the plan relies on (live, 3 November 2026)

| Item | everis2 |
|---|---|
| Release | Zurich Patch 12 (`sn_ztsd` needs Patch 10 or later) |
| Now Assist for ITSM `sn_itsm_gen_ai` | 18.0.2 (needs 15.0.10 or later) |
| `sn_itsm_aia` | 12.0.1 (needs 5.1 or later) |
| `sn_aia` | 8.3.6 (needs 8.3.4 or later) |
| Voice | `sn_voice_aia` 5.2.4 and `sn_itsm_voice_aia` 1.4.0 installed, 6 ITSM voice agents off |
| Available, not installed | `sn_ztsd` 3.3.3, `sn_voice_test_ui` 1.0.14, `sn_dex` 5.3.2, `sn_dex_gen_ai` 5.2.10, `sn_dex_demo_data` 5.0.2, EmployeeWorks `sn_ex_emp_hub_mw` 1.1.12 |
| snagentic | registered as `everis2`, kind `development` |
