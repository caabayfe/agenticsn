import { action, Flow, FlowStage, trigger, wfa } from '@servicenow/sdk/automation'

// A2 stages: two stages activated in order.
export const a2StagesFlow = Flow(
    {
        $id: Now.ID['a2_stages_flow'],
        name: 'snagentic test A2 stages',
        runAs: 'system',
        stages: {
            triage: FlowStage({ label: 'Triage', value: 'triage', alwaysShow: true }),
            closure: FlowStage({ label: 'Closure', value: 'closure', duration: Duration({ hours: 1 }) }),
        },
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['a2_stages_trigger'] },
        { table: 'incident', condition: 'short_descriptionSTARTSWITHA2STAGE' }
    ),
    (params) => {
        wfa.stage(params.stages.triage)
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['a2_stages_triage'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: 'A2: triage' }),
            }
        )
        wfa.stage(params.stages.closure)
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['a2_stages_closure'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: 'A2: closure' }),
            }
        )
    }
)
