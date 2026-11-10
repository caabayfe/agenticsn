import { type InstanceReader, type InstanceWriter, OperationCancelledError } from "@snagentic/core";

// As the request scheduler does: a request whose signal is aborted is never sent.
export function refusingWhenAborted<R extends InstanceReader>(
  reader: R,
  writer: InstanceWriter,
): { readonly reader: R; readonly writer: InstanceWriter } {
  const guard = <T>(signal: AbortSignal, send: () => Promise<T>): Promise<T> =>
    signal.aborted ? Promise.reject(new OperationCancelledError()) : send();
  return {
    reader: {
      ...reader,
      query: (request, signal) => guard(signal, () => reader.query(request, signal)),
    },
    writer: {
      insert: (table, values, signal) => guard(signal, () => writer.insert(table, values, signal)),
      update: (table, sysId, values, signal) =>
        guard(signal, () => writer.update(table, sysId, values, signal)),
    },
  };
}
