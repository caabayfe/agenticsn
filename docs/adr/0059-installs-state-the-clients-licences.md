# 0059. An install states the client's licences and installs only what they cover

- Status: Accepted (product owner, 2026-11-26: "The install must let the platform team state the
  client's licence, and install only the capabilities it covers"; 2026-11-27: in itsm 0.19.0)
- Date: 2026-11-27
- Requirements: G1, ASR-08
- Relates to: 0026 (accelerators as content packs), 0038 (install and platform components), 0048
  (demo modules left out by a switch)

## Context

A module's components say whether they are free or licensed (`entitlement`), not which licence
covers them. A licensed component a PDI or a client instance can activate is not always one the
client pays for: an instance activates Performance Analytics Premium or Predictive Intelligence
on request, and the client is then out of compliance. Since 2.19.0 an install leaves out a module
whose licensed component the instance refuses, but an instance that does not refuse says nothing
about the subscription. The incident guide (Q85) asked who decides; the owner: the platform team
states the client's licences, and the install installs only what they cover.

## Decision

1. **A pack declares its licences** in `accelerator.yaml`: `licences: { <id>: <label> }`, such as
   `itsm-pro: "ITSM Professional (Advanced tier)"`. The ids are the pack's reading of ServiceNow's
   subscriptions; the label says which, for the platform team to match with the client's order.
2. **A licensed component names the licence that covers it:** `licence: <id>` in `module.yaml`.
   An undeclared id is a manifest problem. A licensed component without one is covered by its own
   id (`--licences com.snc.pa.premium`), so a pack that names no licences still works.
3. **`accelerator install --licences a b`** states the client's licences. The plan leaves out
   every selected module with a licensed component no stated licence covers, and the modules that
   depend on it, each with its reason; the rest installs. A stated id that is neither one of the
   pack's licences nor a licensed component of its modules is a problem: a typo would otherwise
   install less than meant, silently.
4. **Without `--licences`, nothing changes** in what is installed: the plan warns, naming the
   licences the selected modules need, so the platform team sees what it is about to assume.
5. **The plan id holds the stated licences**, so an approved plan is for the licences it named.

## Consequences

- A client's install never activates what the client has not bought, as far as the pack's
  licence tags are right. The tags are the pack's responsibility and say "to confirm with the
  ServiceNow account manager" where the subscription is not certain.
- A free component never filters anything.
- `--licences` changes only the selection; the components, data and push are unchanged.

## Alternatives considered

- **Read the subscription from the instance** (`license_details`): it lists what the instance
  holds, which on a PDI or a sub-production instance is not the client's order, and the table's
  content differs between releases.
- **Profiles per licence:** the pack already has `-advanced` profiles; they cannot say which
  optional modules a client may add by name, and they multiply with every licence combination.
- **Make `--licences` mandatory:** every existing install command would break; a warning shows
  the assumption instead.
