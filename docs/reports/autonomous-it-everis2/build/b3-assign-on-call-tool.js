// B3 (Q02) script tool "Assign incident to the on-call person (AIT)", Global scope.
// Used by the Global workflow "Asignar a la guardia (AIT)", with supervised execution
// so the user confirms before the incident changes. Runs as the user: GlideRecordSecure
// applies their ACLs, so an agent without write access to the incident is refused.
(function(inputs) {
    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var number = str(inputs.incident_number);
    var inc = new GlideRecordSecure('incident');
    if (!number || (!inc.get('number', number) && !inc.get(number))) {
        return { error: true, message: 'Incident not found or not readable: ' + number };
    }
    if (!inc.canWrite()) {
        return { error: true, message: 'You cannot update ' + str(inc.getValue('number')) + '.' };
    }
    var groupId = str(inc.getValue('assignment_group'));
    if (!groupId) {
        return { error: true, message: 'The incident has no assignment group, so there is no on-call rota to use.' };
    }

    // Resolve the assignee: a name the user gave, or whoever is first on call now.
    var userId = '';
    var wanted = str(inputs.assignee_name);
    if (wanted) {
        var mem = new GlideRecord('sys_user_grmember');
        mem.addQuery('group', groupId);
        mem.addQuery('user.name', 'CONTAINS', wanted);
        mem.query();
        if (mem.next()) userId = str(mem.getValue('user'));
        if (!userId) {
            return { error: true, message: wanted + ' is not a member of ' + str(inc.getDisplayValue('assignment_group')) + '.' };
        }
    } else {
        var oc = new OnCallRotation().whoIsOnCall(groupId, '', '', new GlideDateTime()) || [];
        var best = null;
        for (var i = 0; i < oc.length; i++) {
            if (!best || oc[i].order < best.order) best = oc[i];
        }
        if (!best) {
            return { error: true, message: 'Nobody is on call now for ' + str(inc.getDisplayValue('assignment_group')) + '.' };
        }
        userId = str(best.userId);
    }

    var before = str(inc.getDisplayValue('assigned_to')) || 'Unassigned';
    inc.setValue('assigned_to', userId);
    if (str(inc.getValue('state')) == '1') inc.setValue('state', 2);
    var note = str(inputs.work_note);
    if (note) inc.work_notes = note;
    if (!inc.update()) {
        return { error: true, message: 'The update was refused.' };
    }

    return {
        incident: str(inc.getValue('number')),
        assigned_to_before: before,
        assigned_to_now: str(inc.getDisplayValue('assigned_to')),
        state_now: str(inc.getDisplayValue('state')),
        work_note_added: note ? note : '(none)'
    };
})(inputs);
