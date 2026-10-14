import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// Spike S11: a second flow, delivered for the first time in a clean capture run.
export const s11FlowB = Flow(
    {
        $id: Now.ID['s11_flow_b'],
        name: 'snagentic spike S11 flow B',
        description: 'Spike S11: adds a work note to incidents whose short description starts with S11B',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['s11_b_trigger'] },
        { table: 'incident', condition: 'short_descriptionSTARTSWITHS11B' }
    ),
    (params) => {
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['s11_b_update'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: 'S11 flow B ran' }),
            }
        )
    }
)
