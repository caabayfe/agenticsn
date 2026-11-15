import { Action, actionStep, Flow, Subflow, trigger, wfa } from '@servicenow/sdk/automation'
import { IntegerColumn, StringColumn } from '@servicenow/sdk/core'

export const p1Action = Action(
    {
        $id: Now.ID['p1_accept_action'],
        name: 'P1_ACCEPT_TAG action',
        inputs: { threshold: StringColumn({ label: 'Threshold', mandatory: true }) },
        outputs: { verdict: StringColumn({ label: 'Verdict' }) },
    },
    (params) => {
        const step = wfa.actionStep(
            actionStep.script,
            { $id: Now.ID['p1_accept_script'], label: 'Pure calculation' },
            {
                required_run_time: 'instance',
                script: Now.include('./scripts/calculate.js'),
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

export const p1Subflow = Subflow(
    {
        $id: Now.ID['p1_accept_subflow'],
        name: 'P1_ACCEPT_TAG subflow',
        inputs: { threshold: StringColumn({ label: 'Threshold', mandatory: true }) },
        outputs: { verdict: StringColumn({ label: 'Verdict' }) },
    },
    (params) => {
        const result = wfa.action(p1Action, { $id: Now.ID['p1_accept_subflow_action'] }, {
            threshold: wfa.dataPill(params.inputs.threshold, 'string'),
        })
        wfa.flowLogic.assignSubflowOutputs({ $id: Now.ID['p1_accept_subflow_output'] }, params.outputs, {
            verdict: wfa.dataPill(result.verdict, 'string'),
        })
    }
)

// The reserved ID is never created by these tests. Publishing cannot affect ordinary records.
export const p1Flow = Flow(
    { $id: Now.ID['p1_accept_flow'], name: 'P1_ACCEPT_TAG flow' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['p1_accept_trigger'] }, {
        table: 'sys_properties', condition: 'sys_id=P1_NEVER_CREATED_ID',
    }),
    () => {
        wfa.subflow(p1Subflow, { $id: Now.ID['p1_accept_flow_subflow'] }, {
            threshold: '70', waitForCompletion: true,
        })
    }
)
