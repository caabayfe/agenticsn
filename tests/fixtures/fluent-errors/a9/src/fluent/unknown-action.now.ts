import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A9: an action that does not exist.
export const unknownAction = Flow(
    { $id: Now.ID['a9_unknown_flow'], name: 'snagentic test A9 unknown action', runAs: 'system' },
    wfa.trigger(trigger.record.created, { $id: Now.ID['a9_unknown_trigger'] }, { table: 'incident' }),
    (params) => {
        wfa.action(
            action.core.updateRecordz,
            { $id: Now.ID['a9_unknown_step'] },
            { table_name: 'incident', record: wfa.dataPill(params.trigger.current, 'reference') }
        )
    }
)
