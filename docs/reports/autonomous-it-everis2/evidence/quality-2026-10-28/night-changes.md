# Changes made on everis2 on the night of 28 October, and how to revert them

Every change made for the quality plan, under the owner's approval for data, configuration and
activations. Revert in reverse order.

- INC0025307: state In Progress, group DEMO.PI.Identity, assigned to test user, Spanish work note with the MFA fix (Q04 setup).
- sys_user_grmember 64cfd154335c5310e4525e1ace5c7b87: test user added to DEMO.PI.Identity (had 0 members).
- INC0025307 resolved by the AI wrap-up (22:20); KB0010018 probe draft c4e22d5c335c5310e4525e1ace5c7bd2.
- Update sets to mark ignore (empty): AIT-Q04 Global 2f12e11c, scoped AIT-Q01 b204e950.
- Q01 Global copies in update set AIT-Q01-sla-explain-sla (8683a110): usecase ee94e1d0339c5310e4525e1ace5c7b07 "Explain SLA (AIT)", agent 45c6e1d8339c5310e4525e1ace5c7b05, team member a294e1d0339c5310e4525e1ace5c7b30. Revert: back out the set or deactivate the usecase.
- sla_definition_sla_breakdown rows (NOT captured in an update set; delete these 8 to revert): 2bd8259033dc5310e4525e1ace5c7bc3, 3fd8e59033dc5310e4525e1ace5c7b92, 4ce8e59033dc5310e4525e1ace5c7b94, 7bd8259033dc5310e4525e1ace5c7bc5, 7bd8e59033dc5310e4525e1ace5c7b8c, bbd8e59033dc5310e4525e1ace5c7b8e, e7d8259033dc5310e4525e1ace5c7bc0, fbd8e59033dc5310e4525e1ace5c7b90.
- INC0025306 reassigned Network -> Database (23:00). INC0025490 "[AI-TEST] SLA breakdown probe" created (Network -> Database).
- User preferences: updateSetForScope (2), apps.current_app.
- F1 persona sys_user 699a291433dc5310e4525e1ace5c7bb3 "Analista AIT (ES)" (language es, no password), roles itil 719a29d4, now_assist_panel_user 269a69d4...bc3, sla_explain 269a69d4...bcb.
- F3 articles (IT KB, Spanish, published via approval as admin on Bernard Laboy approvals): KB0010019 VPN Windows 296be998..., KB0010020 MFA new phone b56b21d8...5f, KB0010021 SAP V1 801 b56b21d8...68. Revert: retire. Later MOVED to KB "Knowledge" (dfc19531) because IT KB is ACME-only.
- Q04 retest: persona added to DEMO.PI.Identity (grmember 064dad50...b11); INC0025491 5a4dad50...b1a MFA, In Progress, assigned to persona, Spanish work note.
- INC0025491 resolved by the AI as persona (Solución proporcionada); AI work note from Investigate and recommend. Persona execution plans left in_progress (Q01/Q07/Q03/Q04 chats).

## Day 2 (29 October)

Same approval (data, configuration, activations for the quality plan). Details and revert steps are
in each `*-fix-runs.md` file.

- Persona: roles `now.assist.creator.analytics` (9c535f94...b5e, Q11) and `oc_read` (54bb1314...be6,
  Q02); manager Bow Ruggeri (Q09).
- Q08/Q09: update set `AIT-Q08-Q09-request-catalog` (0a859fdc...bff): Visio variables `ait_motivo`
  (8eb5d710...b4b) and `ait_equipo` (a2b5d710...bb5). Data: laptops PC-AIT-ES-01 (7aa5d310...b59),
  PC-AIT-ES-02 (b2a55710...b69); REQ0010069/RITM0010067 (Beth Anglin, due 27 Oct, comment),
  RITM0010068 with approval cb089758...b10; INC0025715 (VPN, on hold); INC0025491 caller set to the
  persona.
- Q02: users Marta Ruiz, Jordi Puig, Elena Soto (fictitious, no password), itil, in DEMO.PI.SAP
  (Elena manager); schedule 27d9db9c...b16, span 6fd9db9c...b4c, rota afd9db9c...b54, rosters
  bbd99f5c...b6e and bfd99f5c...b75, members f44a9bdc...bb2, 008a5b98...c2e, e9aa9b10...b03;
  INC0025716 (SAP V1 801, P2).
- Q05: SAP AppSRV01, AppSRV02, LoadBal01 support group DEMO.PI.SAP and owner Elena (were empty);
  CHG0030111 (dd9c97d4...b8f) closed successful, its approvals approved as admin; events from source
  AIT-Demo, alerts Alert0010111 to Alert0010114.
- Q06: update set `AIT-Q06-alert-automation` (429e571c...b5c): inactive grouping automation "Group
  by SAP PRD hosts" created by the AI agent (a6ae5f9c...b1b and ...b1d).
- Q13: update set `AIT-Q13-ai-value` (3700e790...b4a, empty); "Summarize alert AI insights" moved to
  Managed in AI Control Tower (revert: Unmanage).
- Current update set for the test user: `AIT-Q13-ai-value`. Switch back to Default when done.
