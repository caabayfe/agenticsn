import {
  type DevelopmentProfile,
  ensureDevelopmentInstance,
  type FluentInstaller,
  type ImportSetWriter,
  type InstanceWriter,
  type PluginActivator,
  type StoreAppInstaller,
} from "@snagentic/core";
import { authorize, type RequestSender } from "./authorization";
import { CicdAppInstaller } from "./cicd-app-installer";
import { CicdPluginActivator } from "./cicd-plugin-activator";
import { ApiFluentInstaller } from "./fluent-installer";
import { ImportSetApiWriter } from "./import-set-writer";
import { ServiceNowClient } from "./servicenow-client";
import { TableApiWriter } from "./table-api-writer";

// A connection that can change its instance (ADR-0012 layer 3): opened only for a development
// profile, and refused at run time for any other, even one forged past the type.
export class ServiceNowWriteClient extends ServiceNowClient {
  // Plugin activation through the CI/CD API, over this connection.
  readonly plugins: PluginActivator = new CicdPluginActivator(this);
  readonly apps: StoreAppInstaller = new CicdAppInstaller(this);
  // Table API writes, for push.
  readonly writer: InstanceWriter = new TableApiWriter(this);
  // Fluent builds loaded and published through the ServiceNow IDE's endpoints (ADR-0028).
  readonly fluent: FluentInstaller = new ApiFluentInstaller(this);
  // Accelerator data loads through the Import Set API (ADR-0026).
  readonly imports: ImportSetWriter = new ImportSetApiWriter(this);

  constructor(
    profile: DevelopmentProfile,
    secret: string,
    scheduler: RequestSender,
    version: string,
    sign: typeof authorize = authorize,
  ) {
    ensureDevelopmentInstance(profile, "opening a write connection");
    super(profile, secret, scheduler, version, sign);
  }
}
