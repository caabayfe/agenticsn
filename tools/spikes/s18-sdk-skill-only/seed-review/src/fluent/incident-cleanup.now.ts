import { ScriptInclude } from "@servicenow/sdk/core";

ScriptInclude({
  $id: Now.ID["incident-cleanup"],
  name: "IncidentCleanup",
  script: Now.include("../server/incident-cleanup.server.js"),
  active: true,
});
