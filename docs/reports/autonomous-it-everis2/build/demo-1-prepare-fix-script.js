// Fix Script "AIT demo 1 - prepare (day before)", Global scope, update set AIT-P2-demo-prep.
// Run it the day before the demo (System Definition > Fix Scripts > Run Fix Script). It is safe to run
// again: each run retires the copies of the previous run and makes new ones.
// It refreshes the records that a demo uses up, resets the ones a scene changes, and prints the demo
// route: every record to open, in the order of the storyline, with a check of its state.
// Demo data only: every record it creates is tagged [AIT-DEMO] or [AIT-P1], on DEMO.PI groups or the
// SAP demo CIs. It changes no configuration.
(function() {
    var TAG = '[AIT-DEMO]';
    var log = [];
    var problems = 0;
    function say(line) { log.push(line); }
    function check(ok, line) { if (!ok) { problems++; } say((ok ? '  OK    ' : '  CHECK ') + line); }
    function byName(table, field, value) {
        var gr = new GlideRecord(table);
        return gr.get(field, value) ? gr.getUniqueValue() : '';
    }
    function incident(number) {
        var gr = new GlideRecord('incident');
        return gr.get('number', number) ? gr : null;
    }
    // The first work note is the analyst's own Spanish note; later ones were written by the AI.
    function firstWorkNote(gr) {
        var j = new GlideRecord('sys_journal_field');
        j.addQuery('name', 'incident');
        j.addQuery('element_id', gr.getUniqueValue());
        j.addQuery('element', 'work_notes');
        j.orderBy('sys_created_on');
        j.setLimit(1);
        j.query();
        return j.next() ? j.getValue('value') : '';
    }
    function minutesFromNow(minutes) {
        var t = new GlideDateTime();
        t.addSeconds(minutes * 60);
        return t;
    }

    var persona = byName('sys_user', 'user_name', 'ait.analista.es');
    var abel = byName('sys_user', 'user_name', 'abel.tuter');
    var group = {
        identity: byName('sys_user_group', 'name', 'DEMO.PI.Identity'),
        m365: byName('sys_user_group', 'name', 'DEMO.PI.M365'),
        network: byName('sys_user_group', 'name', 'DEMO.PI.Network'),
        sap: byName('sys_user_group', 'name', 'DEMO.PI.SAP'),
        workplace: byName('sys_user_group', 'name', 'DEMO.PI.Workplace')
    };

    // 1. Retire the copies of the previous run, so the agent's queues and the employee's list stay clean.
    // Only New, In Progress and On Hold: resolved copies keep their close notes.
    var old = new GlideRecord('incident');
    old.addQuery('state', 'IN', '1,2,3');
    old.addQuery('short_description', 'STARTSWITH', TAG).addOrCondition('short_description', 'STARTSWITH', '[AIT-P1]');
    old.query();
    var retired = 0;
    while (old.next()) {
        old.state = 6;
        old.close_code = 'Solution provided';
        old.close_notes = 'Copia de demo retirada por la preparación de la demo.';
        old.update();
        retired++;
    }

    // 2. Fresh copies of the MFA incidents that scenes 2.2, 2.2b and 2.4 use up. The caller is Abel
    // Tuter, not the persona, so the persona's own list (scene 1.3) keeps its 5 tickets.
    function copyIncident(templateNumber, setup) {
        var src = incident(templateNumber);
        if (!src) { return null; }
        var inc = new GlideRecord('incident');
        inc.initialize();
        inc.short_description = TAG + ' ' + src.getValue('short_description').replace(/^\[[^\]]*\]\s*/, '');
        inc.description = src.getValue('description');
        inc.category = src.getValue('category');
        inc.subcategory = src.getValue('subcategory');
        inc.cmdb_ci = src.getValue('cmdb_ci');
        inc.impact = src.getValue('impact');
        inc.urgency = src.getValue('urgency');
        inc.caller_id = abel;
        setup(inc, src);
        return inc.insert() ? inc : null;
    }
    var recommend = copyIncident('INC0025307', function(inc) {
        inc.assignment_group = group.network;           // the routing mistake the scene corrects
    });
    var wrongGroup = copyIncident('INC0026051', function(inc) {
        inc.assignment_group = group.m365;              // wrong group; B8 recommends Identity
    });
    var wrapUp = copyIncident('INC0025491', function(inc, src) {
        inc.assignment_group = group.identity;
        inc.assigned_to = persona;
        inc.state = 2;
        inc.work_notes = firstWorkNote(src);             // the Spanish note the wrap-up turns into close notes
    });

    // 3. Reset the on-call incident of scene 3.2: unassigned and New in DEMO.PI.SAP.
    var onCall = incident('INC0025716');
    if (onCall) {
        onCall.assignment_group = group.sap;
        onCall.assigned_to = '';
        onCall.state = 1;
        onCall.update();
    }

    // 4. SAP outage of scene 3.1: close the previous demo alerts, move the kernel change to 80 minutes
    // ago, and send the three events again. Alerts and their AI notes are ready about 2 minutes later.
    var oldAlerts = new GlideRecord('em_alert');
    oldAlerts.addQuery('source', 'AIT-Demo');
    oldAlerts.addQuery('state', '!=', 'Closed');
    oldAlerts.query();
    var closedAlerts = 0;
    var parents = [];
    while (oldAlerts.next()) {
        if (oldAlerts.getValue('parent')) { parents.push(oldAlerts.getValue('parent')); }
        oldAlerts.state = 'Closed';
        oldAlerts.update();
        closedAlerts++;
    }
    // Group alerts have no source of their own: close the groups of the closed alerts too, so the new
    // alerts form a new group.
    var groups = new GlideRecord('em_alert');
    groups.addQuery('sys_id', 'IN', parents.join(','));
    groups.addQuery('state', '!=', 'Closed');
    groups.query();
    while (groups.next()) {
        groups.state = 'Closed';
        groups.update();
        closedAlerts++;
    }
    var change = new GlideRecord('change_request');
    var changeOk = change.get('number', 'CHG0030111');
    if (changeOk) {
        change.setWorkflow(false);
        change.start_date = minutesFromNow(-140);
        change.work_start = minutesFromNow(-140);
        change.end_date = minutesFromNow(-80);
        change.work_end = minutesFromNow(-80);
        change.update();
    }
    var sent = [];
    var seen = {};
    var ev = new GlideRecord('em_event');
    ev.addQuery('source', 'AIT-Demo');
    ev.orderByDesc('sys_created_on');
    ev.setLimit(30);
    ev.query();
    var stamp = new GlideDateTime().getNumericValue();
    while (ev.next() && sent.length < 3) {
        var key = ev.getValue('node') + '|' + ev.getValue('resource') + '|' + ev.getValue('metric_name');
        if (seen[key]) { continue; }
        seen[key] = true;
        var copy = new GlideRecord('em_event');
        copy.initialize();
        ['source', 'event_class', 'node', 'type', 'resource', 'metric_name', 'severity', 'description',
            'additional_info', 'ci_identifier'].forEach(function(f) { copy.setValue(f, ev.getValue(f)); });
        copy.message_key = (ev.getValue('message_key') || key).replace(/#demo\d+$/, '') + '#demo' + stamp;
        copy.time_of_event = new GlideDateTime();
        copy.insert();
        sent.push(ev.getValue('node') + ' ' + ev.getValue('metric_name'));
    }

    // 5. Yesterday's autonomous SLA note (scene 2.5): an [AIT-P1] incident that starts the 12-minute
    // demo SLA in Workplace and moves to SAP 3 minutes later, as case R1 of the pilot (12 of 12).
    // The note arrives about 9.5 minutes after this script runs.
    var p1 = new GlideRecord('incident');
    p1.initialize();
    p1.short_description = '[AIT-P1] SAP: los pedidos de venta no se guardan';
    p1.description = 'Desde esta mañana los pedidos de venta (VA01) dan error al guardar.';
    p1.caller_id = abel;
    p1.assignment_group = group.workplace;
    p1.impact = 2;
    p1.urgency = 2;
    var p1Ok = p1.insert();
    if (p1Ok) {
        var move = new ScheduleOnce();
        move.script = "var i = new GlideRecord('incident'); if (i.get('" + p1.getUniqueValue() + "')) { " +
            "i.assignment_group = '" + group.sap + "'; i.update(); }";
        move.setTime(minutesFromNow(3));
        move.setLabel('AIT demo: move ' + p1.getValue('number') + ' to DEMO.PI.SAP');
        move.schedule();
    }

    // 6. The demo route, in the order of the storyline, with a check of each record.
    function num(gr) { return gr ? gr.getValue('number') : '(not created)'; }
    function state(number, table) {
        var gr = new GlideRecord(table || 'incident');
        return gr.get('number', number) ? gr.getDisplayValue('state') : 'missing';
    }
    var kb = new GlideRecord('kb_knowledge');
    var kbOk = kb.get('number', 'KB0010019') && kb.getValue('workflow_state') == 'published';
    var r67 = new GlideRecord('sc_req_item');
    var r67Ok = r67.get('number', 'RITM0010067') && r67.active == true;
    var r68 = new GlideRecord('sc_req_item');
    var r68Ok = r68.get('number', 'RITM0010068') && r68.getValue('approval') == 'requested';
    var mineCount = 0;
    var mineInc = new GlideRecord('incident');
    mineInc.addQuery('state', 'IN', '1,2,3');
    mineInc.addQuery('caller_id', persona);
    mineInc.query();
    mineCount += mineInc.getRowCount();
    var mineReq = new GlideRecord('sc_req_item');
    mineReq.addActiveQuery();
    mineReq.addQuery('request.requested_for', persona);
    mineReq.query();
    mineCount += mineReq.getRowCount();
    var breach = new GlideRecord('task_sla');
    breach.addQuery('task.number', 'INC0010147');
    breach.addQuery('has_breached', true);
    breach.setLimit(1);
    breach.query();
    var trigger = new GlideRecord('sn_aia_trigger_configuration');
    var triggerOk = trigger.get('9ebfd22433989f10becbf499ed5c7b58') && trigger.active == true;
    // Scene 3.4 creates the grouping automation "Group by SAP PRD hosts"; a previous one makes the AI
    // propose a duplicate. Deleting it is left to a person (Alert grouping automations list).
    var automations = new GlideRecord('sn_em_tbac_alert_clustering_definitions');
    var automationCount = 0;
    if (automations.isValid()) {
        automations.addQuery('name', 'CONTAINS', 'SAP PRD');
        automations.query();
        automationCount = automations.getRowCount();
    }

    say('AIT demo prepared. Retired ' + retired + ' old copies, closed ' + closedAlerts + ' old demo alerts.');
    say('');
    say('Act 1, the employee (Employee Center chat, as Analista AIT (ES))');
    check(kbOk, '1.1 KB0010019 VPN article is published');
    check(r67Ok && r68Ok, '1.2 Visio: RITM0010067 open and RITM0010068 waiting for approval');
    check(state('INC0025715') == 'On Hold', '1.3 INC0025715 VPN is on hold (needs her answer)');
    say('        1.3 the persona has ' + mineCount + ' open incidents and requests (expected 4: INC0025715, INC0025716, RITM0010067, RITM0010068)');
    say('');
    say('Act 2, the service desk (SOW, Otto panel, as Analista AIT (ES))');
    check(state('INC0025308') != 'missing', '2.1 INC0025308 second monitor (a request in disguise): ' + state('INC0025308'));
    check(!!recommend, '2.2 ' + num(recommend) + ' MFA in DEMO.PI.Network: assign it to DEMO.PI.Identity and the persona');
    check(!!wrongGroup, '2.2b ' + num(wrongGroup) + ' MFA in DEMO.PI.M365: ask for the plan with evidence');
    check(breach.hasNext(), '2.3 INC0010147 has a breached SLA');
    check(!!wrapUp, '2.4 ' + num(wrapUp) + ' MFA In Progress, assigned to the persona: close and resolve it');
    check(!!p1Ok && triggerOk, '2.5 ' + num(p1Ok ? p1 : null) + ' [AIT-P1]: autonomous note in about 10 minutes (trigger active: ' + triggerOk + ')');
    say('');
    say('Act 3, operations (SOW as admin for alerts, then the persona)');
    check(changeOk, '3.1 CHG0030111 kernel change moved to 80 minutes before the events');
    check(sent.length == 3, '3.1 events sent: ' + sent.join('; ') + '. Open the newest alert group on SAP AppSRV01');
    check(!!onCall, '3.2 INC0025716 SAP V1 801 reset: unassigned, New, DEMO.PI.SAP');
    check(state('INC0025194') != 'missing', '3.3 INC0025194 runbook PDF: ' + state('INC0025194'));
    check(automationCount == 0, '3.4 grouping automations named "SAP PRD": ' + automationCount + ' (delete the rehearsal one, or it proposes a duplicate)');
    say('');
    say('Act 4, management: analytics chat (persona) and AI Agent Analytics (admin). Nothing to prepare.');
    say('');
    say(problems ? problems + ' item(s) to check before the demo.' : 'Everything is ready.');

    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
