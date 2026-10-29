// B2 (Q09) script tool "Get pending items on my tickets (AIT)", Global scope.
// Linked to the OOB Request Status Agent. Returns, for each open ticket of the
// logged-in user, what it is waiting for and whether the user must act.
(function(inputs) {
    var me = gs.getUserID();
    var meName = gs.getUserName();
    var now = new GlideDateTime();
    var tickets = [];

    function lastCommentByOthers(table, sysId) {
        var j = new GlideRecord('sys_journal_field');
        j.addQuery('name', table);
        j.addQuery('element_id', sysId);
        j.addQuery('element', 'comments');
        j.addQuery('sys_created_by', '!=', meName);
        j.orderByDesc('sys_created_on');
        j.setLimit(1);
        j.query();
        if (j.next()) {
            return { text: String(j.getValue('value')).substring(0, 600), on: j.getValue('sys_created_on') };
        }
        return null;
    }

    function pendingApprovers(sysId) {
        var names = [];
        var a = new GlideRecord('sysapproval_approver');
        a.addQuery('sysapproval', sysId);
        a.addQuery('state', 'requested');
        a.query();
        while (a.next()) {
            names.push(a.getDisplayValue('approver'));
        }
        return names;
    }

    function daysBetween(fromGdt, toGdt) {
        return Math.ceil((toGdt.getNumericValue() - fromGdt.getNumericValue()) / 86400000);
    }

    // Incidents opened by or for the user
    var inc = new GlideRecordSecure('incident');
    inc.addEncodedQuery('active=true^caller_id=' + me + '^ORopened_by=' + me);
    inc.orderByDesc('sys_updated_on');
    inc.setLimit(20);
    inc.query();
    while (inc.next()) {
        var t = {
            number: inc.getValue('number'),
            type: 'incident',
            short_description: inc.getValue('short_description'),
            state: inc.getDisplayValue('state'),
            assignment_group: inc.getDisplayValue('assignment_group'),
            assigned_to: inc.getDisplayValue('assigned_to') || 'Unassigned',
            last_updated: inc.getValue('sys_updated_on'),
            waiting_for: '',
            user_action_needed: false
        };
        var holdReason = inc.getValue('hold_reason');
        if (inc.getValue('state') == '6') {
            t.waiting_for = 'nothing: resolved, it closes automatically unless the user says it is not fixed';
        } else if (inc.getValue('state') == '3' && holdReason == '1') {
            t.waiting_for = 'the user (caller): the support team is waiting for an answer from the user';
            t.user_action_needed = true;
        } else if (inc.getValue('state') == '3') {
            t.waiting_for = 'on hold: ' + inc.getDisplayValue('hold_reason');
        } else if (!inc.getValue('assigned_to')) {
            t.waiting_for = 'assignment to a technician';
        } else {
            t.waiting_for = 'work by ' + t.assigned_to;
        }
        var c = lastCommentByOthers('incident', inc.getUniqueValue());
        if (c) {
            t.last_comment_from_support = c.text;
            t.last_comment_on = c.on;
        }
        tickets.push(t);
    }

    // Requested items opened by or for the user
    var ritm = new GlideRecordSecure('sc_req_item');
    ritm.addEncodedQuery('active=true^requested_for=' + me + '^ORopened_by=' + me);
    ritm.orderByDesc('sys_updated_on');
    ritm.setLimit(20);
    ritm.query();
    while (ritm.next()) {
        var r = {
            number: ritm.getValue('number'),
            type: 'requested item',
            item: ritm.getDisplayValue('cat_item'),
            state: ritm.getDisplayValue('state'),
            stage: ritm.getDisplayValue('stage'),
            approval: ritm.getDisplayValue('approval'),
            assignment_group: ritm.getDisplayValue('assignment_group'),
            assigned_to: ritm.getDisplayValue('assigned_to') || 'Unassigned',
            last_updated: ritm.getValue('sys_updated_on'),
            waiting_for: '',
            user_action_needed: false
        };
        var approvers = pendingApprovers(ritm.getUniqueValue());
        if (ritm.getValue('approval') == 'requested' || approvers.length) {
            r.waiting_for = 'approval by ' + (approvers.length ? approvers.join(', ') : 'the approver');
        } else if (!ritm.getValue('assigned_to')) {
            r.waiting_for = 'assignment to a fulfiller';
        } else {
            r.waiting_for = 'fulfilment by ' + r.assigned_to;
        }
        var due = ritm.getValue('due_date');
        if (due) {
            var dueGdt = new GlideDateTime(due);
            r.due_date = due;
            if (dueGdt.before(now)) {
                r.overdue = true;
                r.days_overdue = daysBetween(dueGdt, now);
            }
        }
        var rc = lastCommentByOthers('sc_req_item', ritm.getUniqueValue());
        if (rc) {
            r.last_comment_from_support = rc.text;
            r.last_comment_on = rc.on;
        }
        tickets.push(r);
    }

    // Global scope returns Java strings from GlideRecord; the agent runtime
    // can only serialise plain JavaScript values.
    function clean(o) {
        if (o === null || o === undefined) return o;
        if (o instanceof Array) return o.map(clean);
        if (typeof o === 'object' && o.constructor === Object) {
            var c = {};
            for (var k in o) c[k] = clean(o[k]);
            return c;
        }
        if (typeof o === 'object') return '' + o;
        return o;
    }

    return clean({
        tickets: tickets,
        count: tickets.length,
        needs_user_action: tickets.filter(function(x) { return x.user_action_needed; }).map(function(x) { return x.number; }),
        overdue: tickets.filter(function(x) { return x.overdue; }).map(function(x) { return x.number; }),
        waiting_for_approval: tickets.filter(function(x) { return String(x.waiting_for).indexOf('approval') === 0; }).map(function(x) { return x.number; }),
        now: '' + now.getValue()
    });
})(inputs);
