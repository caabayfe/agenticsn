import { Action, action, actionStep, Flow, trigger, wfa } from '@servicenow/sdk/automation'
import { IntegerColumn, StringColumn } from '@servicenow/sdk/core'

// A2 custom-action: an action with a script step, used by a flow.
export const a2Action = Action(
    {
        $id: Now.ID['a2_action'],
        name: 'snagentic test A2 action',
        inputs: {
            threshold: StringColumn({ label: 'Threshold', mandatory: true }),
        },
        outputs: {
            verdict: StringColumn({ label: 'Verdict' }),
        },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['a2_action_script'], label: 'Score' },
            {
                required_run_time: 'instance',
                script: Now.include('./scripts/a2-score.js'),
                inputVariables: {
                    threshold: { label: 'Threshold', value: wfa.dataPill(params.inputs.threshold, 'string') },
                },
                outputVariables: {
                    score: IntegerColumn({ label: 'Score', default: '0' }),
                    verdict: StringColumn({ label: 'Verdict', maxLength: 64 }),
                },
            }
        )
        wfa.assignActionOutputs(params.outputs, { verdict: wfa.dataPill(step.verdict, 'string') })
    }
)

export const a2ActionCaller = Flow(
    { $id: Now.ID['a2_action_caller'], name: 'snagentic test A2 action caller', runAs: 'system' },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['a2_action_trigger'] },
        { table: 'incident', condition: 'short_descriptionSTARTSWITHA2ACT' }
    ),
    (params) => {
        const scored = wfa.action(a2Action, { $id: Now.ID['a2_action_call'] }, { threshold: '70' })
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['a2_action_note'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({ work_notes: wfa.dataPill(scored.verdict, 'string') }),
            }
        )
    }
)
