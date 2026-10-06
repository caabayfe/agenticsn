import { authLogin } from "./auth-login";
import { authLogout } from "./auth-logout";
import { describe } from "./describe";
import { doctor } from "./doctor";
import { find } from "./find";
import { init } from "./init";
import { instanceAdd } from "./instance-add";
import { instanceList } from "./instance-list";
import { instanceRemove } from "./instance-remove";
import { integrate } from "./integrate";
import { pluginsActivate } from "./plugins-activate";
import { pluginsList } from "./plugins-list";
import { pull } from "./pull";
import { status } from "./status";
import { updateSetsCollisions } from "./update-sets-collisions";
import { updateSetsExport } from "./update-sets-export";
import { updateSetsList } from "./update-sets-list";
import { updateSetsShow } from "./update-sets-show";
import { updateSetsTool } from "./update-sets-tool";
import type { UseCase } from "./use-case";

// Every operation snagentic offers. Adding one here adds its CLI command and, when marked
// `mcp: true`, its MCP tool.
export const USE_CASES: readonly UseCase[] = [
  init,
  instanceAdd,
  instanceList,
  instanceRemove,
  authLogin,
  authLogout,
  pull,
  integrate,
  status,
  find,
  describe,
  updateSetsList,
  updateSetsShow,
  updateSetsCollisions,
  updateSetsExport,
  updateSetsTool,
  pluginsList,
  pluginsActivate,
  doctor,
];
