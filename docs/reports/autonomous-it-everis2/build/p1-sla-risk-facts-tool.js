// W4.3 pilot 1 script tool "Get SLA risk facts (AIT)", Global scope.
// Used by the agent "SLA at risk AI agent (AIT)", which a trigger starts when the warning SLA
// of a DEMO.PI incident breaches (at 75 % of the resolution SLA). It returns the facts behind the risk, so the agent can
// name a likely cause instead of repeating the SLA record: time used per group, hand-offs,
// how long nobody has written on the incident, and whether anybody owns it.
(function(inputs) {
    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }
    function minutesBetween(a, b) {
        return Math.round((b.getNumericValue() - a.getNumericValue()) / 60000);
    }

    var sla = new GlideRecordSecure('task_sla');
    var slaId = str(inputs.task_sla_id);
    var found = slaId && sla.get(slaId);
    // A warning SLA (a definition with no target, which breaches at 75 % of the real one and
    // starts the trigger) is only a signal: report the incident's response or resolution SLA.
    var number = str(inputs.incident_number);
    if (found && !sla.sla.target.toString()) {
        number = number || str(sla.task.number);
        found = false;
    }
    if (!found && number) {
        // Take the active response or resolution SLA closest to its breach.
        sla = new GlideRecordSecure('task_sla');
        sla.addQuery('task.number', number);
        sla.addQuery('active', true);
        sla.addQuery('sla.target', 'IN', 'response,resolution');
        sla.orderByDesc('business_percentage');
        sla.setLimit(1);
        sla.query();
        found = sla.next();
    }
    if (!found) {
        return { error: true, message: 'No readable active SLA for ' + (number || slaId) };
    }

    var inc = new GlideRecordSecure('incident');
    if (!inc.get(sla.getValue('task'))) {
        return { error: true, message: 'The SLA is not on a readable incident.' };
    }
    var now = new GlideDateTime();

    var result = {
        incident: {
            number: str(inc.getValue('number')),
            short_description: str(inc.getValue('short_description')),
            priority: str(inc.getDisplayValue('priority')),
            state: str(inc.getDisplayValue('state')),
            assignment_group: str(inc.getDisplayValue('assignment_group')),
            assigned_to: str(inc.getDisplayValue('assigned_to')) || 'nobody',
            reassignment_count: parseInt(inc.getValue('reassignment_count'), 10) || 0,
            opened_minutes_ago: minutesBetween(new GlideDateTime(inc.getValue('opened_at')), now)
        },
        sla: {
            task_sla_id: sla.getUniqueValue(),
            name: str(sla.getDisplayValue('sla')),
            business_percentage: Math.round(parseFloat(sla.getValue('business_percentage')) || 0),
            breach_time: str(sla.getDisplayValue('planned_end_time')),
            minutes_left: minutesBetween(now, new GlideDateTime(sla.getValue('planned_end_time')))
        }
    };

    // Time per group, when the SLA definition has the assignment breakdown linked.
    var byGroup = [];
    var bd = new GlideRecord('sla_breakdown_by_assignment');
    if (bd.isValid() && bd.isValidField('task_sla')) {
        bd.addQuery('task_sla', sla.getUniqueValue());
        bd.query();
        while (bd.next()) {
            byGroup.push({
                group: str(bd.getDisplayValue('assignment_group')) || 'unassigned',
                assigned_to: str(bd.getDisplayValue('assigned_to')),
                business_duration: str(bd.getDisplayValue('business_duration')) || str(bd.getDisplayValue('duration'))
            });
        }
    }
    result.time_per_group = byGroup;

    // Silence: the last work note or comment, and who wrote it.
    var j = new GlideRecord('sys_journal_field');
    j.addQuery('name', 'incident');
    j.addQuery('element_id', inc.getUniqueValue());
    j.addQuery('element', 'IN', 'work_notes,comments');
    j.orderByDesc('sys_created_on');
    j.setLimit(1);
    j.query();
    if (j.next()) {
        result.last_update = {
            kind: str(j.getValue('element')) == 'comments' ? 'comment to the caller' : 'work note',
            by: str(j.getValue('sys_created_by')),
            minutes_ago: minutesBetween(new GlideDateTime(j.getValue('sys_created_on')), now)
        };
    } else {
        result.last_update = { kind: 'none', minutes_ago: result.incident.opened_minutes_ago };
    }
    return result;
})(inputs);
