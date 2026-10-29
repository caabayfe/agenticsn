// B3 (Q02) script tool "Get on-call shift and handover (AIT)", Global scope.
// Linked to the OOB "Additional incident context AI agent" (Incident assist). The OOB
// on-call tool says who is on call but not until when; this one adds the shift end,
// who takes over, the escalation line and how to reach each person.
(function(inputs) {
    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var groupId = '';
    var groupName = '';
    var incidentNumber = str(inputs.incident_number);
    if (incidentNumber) {
        var inc = new GlideRecordSecure('incident');
        if (!inc.get('number', incidentNumber) && !inc.get(incidentNumber)) {
            return { error: true, message: 'Incident not found or not readable: ' + incidentNumber };
        }
        groupId = str(inc.getValue('assignment_group'));
        groupName = str(inc.getDisplayValue('assignment_group'));
        incidentNumber = str(inc.getValue('number'));
    }
    if (!groupId && str(inputs.assignment_group_name)) {
        var g = new GlideRecord('sys_user_group');
        if (g.get('name', str(inputs.assignment_group_name))) {
            groupId = g.getUniqueValue();
            groupName = str(g.getValue('name'));
        }
    }
    if (!groupId) {
        return { error: true, message: 'Give an incident with an assignment group, or a group name.' };
    }

    var oc = new OnCallRotation();

    function onCallAt(gdt) {
        var res = oc.whoIsOnCall(groupId, '', '', gdt) || [];
        var list = [];
        for (var i = 0; i < res.length; i++) list.push(res[i]);
        list.sort(function(a, b) { return a.order - b.order; });
        return list;
    }

    function primaryAt(gdt) {
        var l = onCallAt(gdt);
        return l.length ? str(l[0].userId) : '';
    }

    function person(userId) {
        var u = new GlideRecord('sys_user');
        if (!u.get(userId)) return { name: '(unknown)' };
        return {
            name: str(u.getDisplayValue()),
            title: str(u.getValue('title')),
            mobile_phone: str(u.getValue('mobile_phone')),
            business_phone: str(u.getValue('phone')),
            email: str(u.getValue('email'))
        };
    }

    var now = new GlideDateTime();
    var current = onCallAt(now);
    if (!current.length) {
        return { assignment_group: groupName, on_call: [], message: 'Nobody is on call for this group now (no rota or no active roster).' };
    }
    var primaryId = str(current[0].userId);

    // The shift ends when someone else becomes first in line: step a day at a time
    // (up to 21 days), then narrow the change down to the minute.
    var shiftEnd = null;
    var lo = new GlideDateTime(now);
    var hi = null;
    for (var d = 0; d < 21; d++) {
        var probe = new GlideDateTime(lo);
        probe.addSeconds(86400);
        if (primaryAt(probe) != primaryId) { hi = probe; break; }
        lo = probe;
    }
    var nextPrimary = null;
    if (hi) {
        while (hi.getNumericValue() - lo.getNumericValue() > 60000) {
            var mid = new GlideDateTime(lo);
            mid.addSeconds(Math.floor((hi.getNumericValue() - lo.getNumericValue()) / 2000));
            if (primaryAt(mid) == primaryId) lo = mid; else hi = mid;
        }
        shiftEnd = lo;
        var after = onCallAt(hi);
        if (after.length) nextPrimary = person(after[0].userId);
    }

    var line = [];
    for (var i = 0; i < current.length; i++) {
        var p = person(current[i].userId);
        var roster = new GlideRecord('cmn_rota_roster');
        p.position = roster.get(current[i].roster) ? str(roster.getValue('name')) : '';
        p.escalation_order = current[i].order;
        line.push(p);
    }

    var rota = new GlideRecord('cmn_rota');
    var rotaName = rota.get(current[0].rota) ? str(rota.getValue('name')) : '';

    return {
        incident: incidentNumber,
        assignment_group: groupName,
        rota: rotaName,
        now: str(now.getDisplayValue()),
        on_call_now: line[0],
        escalation_line: line,
        shift_ends: shiftEnd ? str(shiftEnd.getDisplayValue()).substring(0, 16) : 'no change in the next 21 days',
        next_on_call_after_shift: nextPrimary,
        how_to_escalate: line.length > 1
            ? 'If ' + line[0].name + ' does not answer, contact ' + line[1].name + ' (' + line[1].position + ').'
            : 'No second line is defined for this rota.'
    };
})(inputs);
