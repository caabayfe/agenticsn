import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// Spike S11: an incident whose short description starts with "S11" gets a work note.
export const s11Flow = Flow(
    {
        $id: Now.ID['s11_flow'],
        name: 'snagentic spike S11 flow',
        description: 'Spike S11: adds a work note to incidents whose short description starts with S11',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['s11_trigger'] },
        { table: 'incident', condition: 'short_descriptionSTARTSWITHS11' }
    ),
    (params) => {
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['s11_update'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: 'S11 flow ran (v5)' }),
            }
        )
    }
)
