import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A2 flow-logic: if / elseIf / else, forEach over lookUpRecords, skipIteration and exitLoop.
export const flowLogicFlow = Flow(
    {
        $id: Now.ID['a2_logic_flow'],
        name: 'snagentic test A2 flow logic',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['a2_logic_trigger'] },
        { table: 'incident', condition: 'short_descriptionSTARTSWITHA2LOGIC' }
    ),
    (params) => {
        wfa.flowLogic.if(
            {
                $id: Now.ID['a2_logic_if_p1'],
                condition: `${wfa.dataPill(params.trigger.current.priority, 'string')}=1`,
            },
            () => {
                wfa.action(
                    action.core.updateRecord,
                    { $id: Now.ID['a2_logic_note_p1'] },
                    {
                        table_name: 'incident',
                        record: wfa.dataPill(params.trigger.current, 'reference'),
                        values: TemplateValue({ work_notes: 'A2: priority 1' }),
                    }
                )
            }
        )
        wfa.flowLogic.elseIf(
            {
                $id: Now.ID['a2_logic_elseif_p2'],
                condition: `${wfa.dataPill(params.trigger.current.priority, 'string')}=2`,
            },
            () => {
                wfa.action(
                    action.core.updateRecord,
                    { $id: Now.ID['a2_logic_note_p2'] },
                    {
                        table_name: 'incident',
                        record: wfa.dataPill(params.trigger.current, 'reference'),
                        values: TemplateValue({ work_notes: 'A2: priority 2' }),
                    }
                )
            }
        )
        wfa.flowLogic.else({ $id: Now.ID['a2_logic_else'] }, () => {
            const related = wfa.action(
                action.core.lookUpRecords,
                { $id: Now.ID['a2_logic_lookup'] },
                { table: 'incident', conditions: 'active=true^priority=1', max_results: 10 }
            )
            wfa.flowLogic.forEach(
                wfa.dataPill(related.Records, 'array.object'),
                { $id: Now.ID['a2_logic_each'] },
                (item) => {
                    wfa.flowLogic.if(
                        {
                            $id: Now.ID['a2_logic_skip_if'],
                            condition: `${wfa.dataPill(item.state, 'string')}=6`,
                        },
                        () => {
                            wfa.flowLogic.skipIteration({ $id: Now.ID['a2_logic_skip'] })
                        }
                    )
                    wfa.flowLogic.if(
                        {
                            $id: Now.ID['a2_logic_exit_if'],
                            condition: `${wfa.dataPill(item.state, 'string')}=7`,
                        },
                        () => {
                            wfa.flowLogic.exitLoop({ $id: Now.ID['a2_logic_exit'] })
                        }
                    )
                    wfa.action(
                        action.core.updateRecord,
                        { $id: Now.ID['a2_logic_note_each'] },
                        {
                            table_name: 'incident',
                            record: wfa.dataPill(item.sys_id, 'reference'),
                            values: TemplateValue({ work_notes: 'A2: related P1' }),
                        }
                    )
                }
            )
        })
    }
)
