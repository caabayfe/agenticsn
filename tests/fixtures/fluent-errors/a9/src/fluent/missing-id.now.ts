import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A9: an action instance without $id.
export const missingId = Flow(
    { $id: Now.ID['a9_noid_flow'], name: 'snagentic test A9 missing id', runAs: 'system' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['a9_noid_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.action(
            action.core.updateRecord,
            {},
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: 'A9' }),
            }
        )
    }
)
