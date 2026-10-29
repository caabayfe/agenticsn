// W4.3 pilot 1 script tool "Add autonomous work note (AIT)", Global scope.
// The only write of the SLA-at-risk pilot (autonomy level 3: act and report). The guardrails
// of W4.5 are here, in code, not in the agent's instructions:
// - only incidents of a DEMO.PI group (decision P2-2);
// - one note per SLA: the note carries a reference to the SLA and a second call is refused;
// - at most MAX_PER_DAY autonomous notes a day across all incidents;
// - every note starts with a fixed prefix, so autonomous writing is easy to find and count.
(function(inputs) {
    var PREFIX = '[AIT auto · SLA en riesgo]';
    var GROUP_PREFIX = 'DEMO.PI.';
    var MAX_PER_DAY = 20;

    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var inc = new GlideRecordSecure('incident');
    var number = str(inputs.incident_number);
    if (!number || (!inc.get('number', number) && !inc.get(number))) {
        return { written: false, reason: 'Incident not found or not readable: ' + number };
    }
    number = str(inc.getValue('number'));
    if (str(inc.getDisplayValue('assignment_group')).indexOf(GROUP_PREFIX) !== 0) {
        return { written: false, reason: number + ' is not in a DEMO.PI group: the pilot does not write on it.' };
    }
    var note = str(inputs.note).trim();
    if (note.length < 40) {
        return { written: false, reason: 'The note is empty or too short.' };
    }

    var ref = str(inputs.task_sla_id).substring(0, 8) || 'nosla';
    var tag = '(ref ' + ref + ')';
    var seen = new GlideRecord('sys_journal_field');
    seen.addQuery('name', 'incident');
    seen.addQuery('element_id', inc.getUniqueValue());
    seen.addQuery('element', 'work_notes');
    seen.addQuery('value', 'STARTSWITH', PREFIX + ' ' + tag);
    seen.setLimit(1);
    seen.query();
    if (seen.hasNext()) {
        return { written: false, reason: 'This SLA already has its autonomous note on ' + number + '.' };
    }

    var today = new GlideAggregate('sys_journal_field');
    today.addQuery('name', 'incident');
    today.addQuery('element', 'work_notes');
    today.addQuery('sys_created_on', '>=', gs.beginningOfToday());
    today.addQuery('value', 'STARTSWITH', PREFIX);
    today.addAggregate('COUNT');
    today.query();
    var count = today.next() ? parseInt(today.getAggregate('COUNT'), 10) : 0;
    if (count >= MAX_PER_DAY) {
        return { written: false, reason: 'Daily limit of ' + MAX_PER_DAY + ' autonomous notes reached.' };
    }

    inc.work_notes = PREFIX + ' ' + tag + '\n' + note;
    if (!inc.update()) {
        return { written: false, reason: 'The update was refused (no write access?).' };
    }
    return { written: true, incident: number, notes_today: count + 1 };
})(inputs);
