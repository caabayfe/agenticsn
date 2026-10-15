// Spec 006 D3: the domains of the reviewers, of their items, and candidate auditors (read-only).
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const rows = (table: string, query: string, fields: string[], limit = 100) =>
  client.query({ table: TableName.parse(table), query, fields, limit }, signal);
const managers = "acme.manager,cisco.manager,initech.manager,oceanic.manager";
console.log(
  JSON.stringify(
    {
      managers: await rows("sys_user", `user_nameIN${managers}`, [
        "sys_id",
        "user_name",
        "sys_domain.name",
        "active",
      ]),
      items: await rows(
        "x_2222332_acc_rev_review_item",
        `campaign=b7bac0ab8373c710292aca75eeaad3f8^assigned_to.user_nameIN${managers}`,
        [
          "number",
          "sys_id",
          "assigned_to.user_name",
          "user.user_name",
          "sys_domain.name",
          "decision",
        ],
      ),
      item_domains: [
        ...new Set(
          (await rows("x_2222332_acc_rev_review_item", "", ["sys_domain.name"], 500)).map(
            (r) => r["sys_domain.name"],
          ),
        ),
      ],
      campaign_domains: await rows("x_2222332_acc_rev_campaign", "", ["number", "sys_domain.name"]),
      domains: await rows("domain", "", ["sys_id", "name", "parent.name"]),
    },
    null,
    2,
  ),
);
