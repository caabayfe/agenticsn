import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

// A2 inbound-email-trigger: an email whose subject mentions A2 creates an incident.
export const a2InboundFlow = Flow(
    { $id: Now.ID['a2_inbound_flow'], name: 'snagentic test A2 inbound email', runAs: 'system' },
    wfa.trigger(
        trigger.application.inboundEmail,
        { $id: Now.ID['a2_inbound_trigger'] },
        { email_conditions: 'subjectLIKEsnagentic A2', target_table: 'incident' }
    ),
    (params) => {
        wfa.action(
            action.core.createRecord,
            { $id: Now.ID['a2_inbound_create'] },
            {
                table_name: 'incident',
                values: TemplateValue({
                    short_description: wfa.dataPill(params.trigger.subject, 'string_full_utf8'),
                    description: wfa.dataPill(params.trigger.body_text, 'string_full_utf8'),
                }),
            }
        )
    }
)
