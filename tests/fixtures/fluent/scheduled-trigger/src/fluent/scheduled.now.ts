import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A2 scheduled-trigger: a daily and a repeating flow.
export const a2Daily = Flow(
    { $id: Now.ID['a2_daily_flow'], name: 'snagentic test A2 daily', runAs: 'system' },
    wfa.trigger(
        trigger.scheduled.daily,
        { $id: Now.ID['a2_daily_trigger'] },
        { time: Time({ hours: 3, minutes: 0, seconds: 0 }, 'UTC') }
    ),
    () => {
        wfa.action(
            action.core.lookUpRecords,
            { $id: Now.ID['a2_daily_lookup'] },
            { table: 'incident', conditions: 'active=true^priority=1', max_results: 5 }
        )
    }
)

export const a2Repeat = Flow(
    { $id: Now.ID['a2_repeat_flow'], name: 'snagentic test A2 repeat', runAs: 'system' },
    wfa.trigger(
        trigger.scheduled.repeat,
        { $id: Now.ID['a2_repeat_trigger'] },
        { repeat: Duration({ hours: 6 }) }
    ),
    () => {
        wfa.action(
            action.core.lookUpRecords,
            { $id: Now.ID['a2_repeat_lookup'] },
            { table: 'incident', conditions: 'active=true^priority=2', max_results: 5 }
        )
    }
)
