// A one-flow Fluent project that `doctor` builds with the embedded SDK. Its keys are committed,
// so a correct build produces exactly one record and leaves keys.ts unchanged.

export const PROBE_RECORD = "dist/app/sys_hub_flow_68854d46d51643d7916febd9525d78b6.xml";

export const PROBE_KEYS_FILE = "src/fluent/generated/keys.ts";

const KEYS = `import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    probe_flow: {
                        table: 'sys_hub_flow'
                        id: '68854d46d51643d7916febd9525d78b6'
                    }
                    probe_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '74bdf91945e946698d34b004bf32c37a'
                    }
                    probe_update: {
                        table: 'sys_hub_action_instance_v2'
                        id: '929122edbb914e178326e376d6de7cc9'
                    }
                }
            }
        }
    }
}
`;

const FLOW = `import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

export const probe = Flow(
    { $id: Now.ID['probe_flow'], name: 'snagentic doctor probe' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['probe_trigger'] }, { table: 'incident', condition: '' }),
    (params) => {
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['probe_update'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: 'probe' }),
            }
        )
    }
)
`;

export const PROBE_FILES: ReadonlyMap<string, string> = new Map([
  ["now.config.json", '{ "scope": "global", "scopeId": "global", "type": "configuration" }\n'],
  ["package.json", '{ "name": "snagentic-doctor-probe", "version": "0.0.1", "private": true }\n'],
  ["src/fluent/probe.now.ts", FLOW],
  [PROBE_KEYS_FILE, KEYS],
]);
