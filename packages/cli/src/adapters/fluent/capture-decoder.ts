import { type CaptureDecoder, publishedCapture } from "@snagentic/core";
import { XMLValidator } from "fast-xml-parser";
import { builtUnitOf, openFluentValue } from "./built-units";

const openFields = (fields: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [field, openFluentValue(value)]),
  );

// Update-set payloads share the built-update format, including compressed JSON fields.
export const decodeCapture: CaptureDecoder = (updateName, payload, live) => {
  if (XMLValidator.validate(payload) !== true) return null;
  try {
    const unit = builtUnitOf(`${updateName}.xml`, payload);
    const opened =
      live == null
        ? live
        : { ...live, head: openFields(live.head), children: live.children.map(openFields) };
    return {
      unit,
      published: publishedCapture(unit),
      ...(opened === undefined ? {} : { live: opened }),
    };
  } catch {
    return null;
  }
};
