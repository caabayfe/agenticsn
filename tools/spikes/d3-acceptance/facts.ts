// Spec 006 D3 (Access Review acceptance scenarios 4 and 5): the reviewers, their items, and who
// holds the auditor role (read-only). Not product code.
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const rows = (table: string, query: string, fields: string[], limit = 500) =>
  client.query({ table: TableName.parse(table), query, fields, limit }, signal);

const campaigns = await rows("x_2222332_acc_rev_campaign", "", [
  "sys_id",
  "number",
  "state",
  "short_description",
]);
const items = await rows("x_2222332_acc_rev_review_item", "", [
  "campaign",
  "assigned_to",
  "decision",
]);
const byReviewer = new Map<string, { pending: number; decided: number }>();
for (const item of items) {
  const key = `${item["campaign"]}|${item["assigned_to"]}`;
  const count = byReviewer.get(key) ?? { pending: 0, decided: 0 };
  item["decision"] === "pending" ? count.pending++ : count.decided++;
  byReviewer.set(key, count);
}
const users = await rows(
  "sys_user",
  `sys_idIN${[...new Set(items.map((i) => i["assigned_to"]))].join(",")}`,
  ["sys_id", "user_name", "name", "active"],
);
const name = (id: string) => users.find((u) => u["sys_id"] === id)?.["user_name"] ?? id;
const role = await rows("sys_user_role", "name=x_2222332_acc_rev.auditor", ["sys_id"]);
const auditors = await rows("sys_user_has_role", `role=${role[0]?.["sys_id"] ?? ""}`, [
  "user.user_name",
  "state",
  "inherited",
]);
console.log(
  JSON.stringify(
    {
      campaigns,
      reviewers: [...byReviewer].map(([k, v]) => {
        const [campaign = "", reviewer = ""] = k.split("|");
        return {
          campaign: campaigns.find((c) => c["sys_id"] === campaign)?.["number"],
          reviewer: name(reviewer),
          ...v,
        };
      }),
      auditors,
    },
    null,
    2,
  ),
);
