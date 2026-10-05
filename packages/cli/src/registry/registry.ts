import { authLogin } from "./auth-login";
import { authLogout } from "./auth-logout";
import { doctor } from "./doctor";
import { init } from "./init";
import { instanceAdd } from "./instance-add";
import { instanceList } from "./instance-list";
import { instanceRemove } from "./instance-remove";
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
  doctor,
];
