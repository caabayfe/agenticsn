import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A9: a data pill with a type that does not match the field.
export const wrongPill = Flow(
    { $id: Now.ID['a9_pill_flow'], name: 'snagentic test A9 wrong pill', runAs: 'system' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['a9_pill_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['a9_pill_step'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'integer'),
                values: TemplateValue({ work_notes: 'A9' }),
            }
        )
    }
)
