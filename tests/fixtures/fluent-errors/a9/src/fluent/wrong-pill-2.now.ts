import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A9: a data pill with an unknown type, and a pill on a field the table does not have.
export const wrongPill2 = Flow(
    { $id: Now.ID['a9_pill2_flow'], name: 'snagentic test A9 wrong pill 2', runAs: 'system' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['a9_pill2_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['a9_pill2_step'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'banana'),
                values: TemplateValue({ work_notes: wfa.dataPill(params.trigger.current.no_such_field, 'string') }),
            }
        )
    }
)
