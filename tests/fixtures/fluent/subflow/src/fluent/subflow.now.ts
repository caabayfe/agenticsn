import { action, Flow, Subflow, trigger, wfa } from '@servicenow/sdk/automation'
import { BooleanColumn, StringColumn } from '@servicenow/sdk/core'

// A2 subflow: inputs and outputs, called from a flow.
export const a2Subflow = Subflow(
    {
        $id: Now.ID['a2_subflow'],
        name: 'snagentic test A2 subflow',
        runAs: 'system',
        inputs: {
            incident: StringColumn({ label: 'Incident sys_id', mandatory: true }),
            note: StringColumn({ label: 'Note' }),
        },
        outputs: {
            done: BooleanColumn({ label: 'Done', mandatory: true }),
        },
    },
    (params) => {
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['a2_subflow_note'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.inputs.incident, 'reference'),
                values: TemplateValue({ work_notes: wfa.dataPill(params.inputs.note, 'string') }),
            }
        )
        wfa.flowLogic.assignSubflowOutputs({ $id: Now.ID['a2_subflow_out'] }, params.outputs, { done: true })
    }
)

export const a2SubflowCaller = Flow(
    { $id: Now.ID['a2_subflow_caller'], name: 'snagentic test A2 subflow caller', runAs: 'system' },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['a2_subflow_trigger'] },
        { table: 'incident', condition: 'short_descriptionSTARTSWITHA2SUB' }
    ),
    (params) => {
        const result = wfa.subflow(
            a2Subflow,
            { $id: Now.ID['a2_subflow_call'] },
            {
                incident: wfa.dataPill(params.trigger.current.sys_id, 'string'),
                note: 'A2: from subflow',
                waitForCompletion: true,
            }
        )
        wfa.flowLogic.if(
            { $id: Now.ID['a2_subflow_check'], condition: `${wfa.dataPill(result.done, 'boolean')}=true` },
            () => {
                wfa.flowLogic.endFlow({ $id: Now.ID['a2_subflow_end'] })
            }
        )
    }
)
