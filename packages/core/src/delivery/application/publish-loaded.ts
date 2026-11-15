import { FlowPublishFailedError } from "../domain/fluent-errors";
import { fluentRecordOf, toPublish } from "../domain/fluent-records";
import type { FluentInstaller } from "../ports";

// A partial or ambiguous acknowledgement is not publication success. In particular, an
// empty response must never certify every requested flow and action.
export async function publishLoaded(
  installer: FluentInstaller,
  scope: string,
  files: readonly { content: string }[],
  signal: AbortSignal,
) {
  const records = files.flatMap((file) => fluentRecordOf(file.content) ?? []);
  const targets = toPublish(records);
  const requested = [...targets.flows, ...targets.actions];
  if (requested.length === 0) return;
  const results = await installer.publish(scope, targets, signal);
  const failed = requested.flatMap((id) => {
    const matches = results.filter((result) => result.sysId === id);
    const result = matches[0];
    if (matches.length === 1 && result?.published === true) return [];
    const message =
      matches.length !== 1
        ? "missing or duplicate publication acknowledgement"
        : (result?.message ?? "not published");
    return [{ name: records.find((record) => record.sysId === id)?.name ?? id, message }];
  });
  for (const result of results.filter((result) => !requested.includes(result.sysId))) {
    failed.push({ name: result.sysId, message: "unexpected publication acknowledgement" });
  }
  if (failed.length > 0) throw new FlowPublishFailedError(failed);
}
