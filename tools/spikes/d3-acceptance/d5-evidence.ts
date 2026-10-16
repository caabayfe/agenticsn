// Spec 006 D5: what the Access Review daily job and notifications did on pdi2 (read-only).
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const rows = (table: string, query: string, fields: string[], limit = 100) =>
  client.query({ table: TableName.parse(table), query, fields, limit }, signal);
const CAMPAIGNS = "4679339383bf8710292aca75eeaad319,b7bac0ab8373c710292aca75eeaad3f8";
const items = await rows(
  "x_2222332_acc_rev_review_item",
  "campaign=b7bac0ab8373c710292aca75eeaad3f8",
  ["reminded_on", "escalated", "decision"],
  500,
);
const tally = (key: string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item[key] ?? "", (counts.get(item[key] ?? "") ?? 0) + 1);
  return [...counts];
};
console.log(
  JSON.stringify(
    {
      campaigns: await rows("x_2222332_acc_rev_campaign", `sys_idIN${CAMPAIGNS}`, [
        "number",
        "state",
        "due_date",
        "sys_created_on",
        "assigned_to.user_name",
      ]),
      job_triggers: await rows("sys_trigger", "document_key=cd6283e68ea856e39ca36d3fea2da1f4", [
        "name",
        "next_action",
        "state",
        "trigger_type",
      ]),
      items_reminded_on: tally("reminded_on"),
      items_escalated: tally("escalated"),
      events: await rows(
        "sysevent",
        `instanceIN${CAMPAIGNS}`,
        ["name", "parm1", "parm2", "state", "sys_created_on", "processed"],
        50,
      ),
      emails: await rows(
        "sys_email",
        `instanceIN${CAMPAIGNS}`,
        ["subject", "type", "recipients", "sys_created_on", "notification_type"],
        50,
      ),
      properties: await rows("sys_properties", "nameSTARTSWITHx_2222332_acc_rev.", [
        "name",
        "value",
      ]),
      mail_sending: await rows(
        "sys_properties",
        "nameINglide.email.smtp.active,glide.email.test.user",
        ["name", "value"],
      ),
    },
    null,
    2,
  ),
);
