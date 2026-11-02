// Fix Script "AIT CSDM SAP 4 - HANA outage", Global scope.
// A second SAP PRD outage, different from scene 3.1, to show the alert group summary and the root
// cause: the HANA log volume fills up because log backups fail after a firewall change, and the
// symptoms climb the SAP S/4HANA PRD service map one layer at a time:
//   HDB PRD on SAP HANADB01   log volume 97 %, log backups failing   <- root cause
//   PRD DVEBMGS00 (AppSRV01)  update work processes stopped, V1 updates queued
//   PRD D10 (AppSRV02)        dialog response time x13
//   SAP WEB02                 HTTP 503 on Fiori
// The events are sent oldest first, a minute apart in event time, and bind to their hosts; the CMDB
// grouping puts them in one group whose CI is the lowest one in the map, SAP HANADB01.
// It also records the cause the AI can find: change "Firewall: restrict outbound traffic from the
// SAP PRD network" on SAP HANADB01, implemented 3 hours ago by DEMO.PI.Network.
// Source AIT-Demo-HANA, so "AIT demo 1" never closes or copies these alerts. Safe to run again: it
// closes its previous alerts and groups first and reuses the change.
(function() {
    var TAG = '[AIT-DEMO]';
    var SOURCE = 'AIT-Demo-HANA';
    var log = [];
    var problems = 0;
    function say(line) { log.push(line); }
    function check(ok, line) { if (!ok) { problems++; } say((ok ? '  OK    ' : '  CHECK ') + line); }
    function byName(table, field, value) {
        var gr = new GlideRecord(table);
        return gr.get(field, value) ? gr.getUniqueValue() : '';
    }
    function minutesFromNow(minutes) {
        var t = new GlideDateTime();
        t.addSeconds(minutes * 60);
        return t;
    }

    // 1. Close the previous run's alerts and their groups, so the new alerts form a new group. The QAS
    // alert of scene 3.1c goes too: the grouping automation "Group alerts with CI relationships" (30
    // minutes) reaches QAS through the business application, which consumes both services, and would
    // put it in this PRD group. "AIT CSDM SAP 3" sends it again.
    var OURS = [SOURCE, 'AIT-Demo-QAS'];
    var old = new GlideRecord('em_alert');
    old.addQuery('source', 'IN', OURS.join(','));
    old.addQuery('state', '!=', 'Closed');
    old.query();
    var closed = 0;
    var parents = [];
    while (old.next()) {
        if (old.getValue('parent')) { parents.push(old.getValue('parent')); }
        old.state = 'Closed';
        old.update();
        closed++;
    }
    // A group that also holds another scene's alerts stays open; ours leave it, so it shows that
    // scene only.
    var groups = new GlideRecord('em_alert');
    groups.addQuery('sys_id', 'IN', parents.join(','));
    groups.addQuery('state', '!=', 'Closed');
    groups.query();
    while (groups.next()) {
        var others = new GlideRecord('em_alert');
        others.addQuery('parent', groups.getUniqueValue());
        others.addQuery('source', 'NOT IN', OURS.join(','));
        others.addQuery('state', '!=', 'Closed');
        others.setLimit(1);
        others.query();
        if (!others.hasNext()) {
            groups.state = 'Closed';
            groups.update();
            closed++;
            continue;
        }
        var ours = new GlideRecord('em_alert');
        ours.addQuery('parent', groups.getUniqueValue());
        ours.addQuery('source', 'IN', OURS.join(','));
        ours.query();
        while (ours.next()) {
            ours.parent = '';
            ours.update();
        }
    }

    // Scene 3.1's outage on the same service would join this group. The grouping window (30 minutes)
    // counts event time, and these events are dated up to 9 minutes back, so scene 3.1's events must
    // be over 40 minutes old. Stop rather than mix the two stories.
    var recent = new GlideRecord('em_alert');
    recent.addQuery('source', 'AIT-Demo');
    recent.addQuery('state', '!=', 'Closed');
    recent.addQuery('last_remote_time', '>=', minutesFromNow(-41));
    recent.setLimit(1);
    recent.query();
    if (recent.next()) {
        check(false, 'scene 3.1 alert ' + recent.getValue('number') + ' is under 41 minutes old (event time); ' +
            'it would join this group. Run again later. Nothing sent.');
        gs.info(log.join('\n'));
        gs.print(log.join('\n'));
        return;
    }
    say('  OK    no scene 3.1 alerts under 41 minutes old (event time)');

    // 2. The change the investigation should find, moved to 3 hours ago on every run.
    var host = byName('cmdb_ci', 'name', 'SAP HANADB01');
    check(!!host, 'SAP HANADB01 exists (run "AIT CSDM SAP 1 - build" first)');
    var chg = new GlideRecord('change_request');
    chg.addQuery('cmdb_ci', host);
    chg.addQuery('description', 'CONTAINS', TAG);
    chg.setLimit(1);
    chg.query();
    var isNew = !chg.next();
    if (isNew) { chg.initialize(); }
    chg.setWorkflow(false);
    chg.cmdb_ci = host;
    chg.business_service = byName('cmdb_ci_service_discovered', 'name', 'SAP S/4HANA PRD');
    chg.assignment_group = byName('sys_user_group', 'name', 'DEMO.PI.Network');
    chg.type = 'normal';
    chg.short_description = 'Firewall: restrict outbound traffic from the SAP PRD network';
    chg.description = 'Security hardening: only allow the ports in the approved matrix from VLAN 120 (SAP PRD) ' +
        'to other networks. The backup VLAN (backint to the backup server, port 4000) was not in the matrix.\n\n' + TAG;
    chg.start_date = minutesFromNow(-200);
    chg.work_start = minutesFromNow(-200);
    chg.end_date = minutesFromNow(-180);
    chg.work_end = minutesFromNow(-180);
    chg.state = 0;
    var chgId = isNew ? chg.insert() : chg.update();
    check(!!chgId, 'change ' + chg.getValue('number') + ' on SAP HANADB01, ended 3 hours ago');

    // 3. The events, root cause first.
    var EVENTS = [
        { node: 'SAP HANADB01', type: 'Database', resource: 'HDB log volume /hana/log/HDB', metric: 'hana_log_volume_used_pct', severity: 1, ago: 9,
          text: 'SAP HANA HDB (PRD): log volume /hana/log/HDB 97% used and growing. Log backups have failed 18 times since ' +
                'the last success 3 hours ago (backint: connection to backup server timed out). When the volume is full the ' +
                'database stops accepting commits.' },
        { node: 'SAP HANADB01', type: 'Database', resource: 'HDB log backup', metric: 'hana_log_backup_status', severity: 2, ago: 8,
          text: 'SAP HANA HDB (PRD): log backup failed, error "backint: connection timed out to backup server 10.20.40.15:4000".' },
        { node: 'SAP AppSRV01', type: 'Application', resource: 'PRD DVEBMGS00 update', metric: 'sap_update_wp_status', severity: 1, ago: 6,
          text: 'SAP PRD central instance DVEBMGS00: all 6 update work processes waiting on database commit; 214 V1 updates ' +
                'queued in SM13; update service deactivated.' },
        { node: 'SAP AppSRV02', type: 'Application', resource: 'PRD D10 dialog', metric: 'sap_dialog_response_ms', severity: 2, ago: 5,
          text: 'SAP PRD dialog instance D10: average dialog response time 8,400 ms (baseline 650 ms), 92% of it database time.' },
        { node: 'SAP WEB02', type: 'Web', resource: 'Web Dispatcher ICM', metric: 'http_5xx_rate', severity: 2, ago: 4, bindCi: true,
          text: 'SAP Web Dispatcher on WEB02: 18% of Fiori requests answered HTTP 503 (backend timeout) in the last 5 minutes.' }
    ];
    var stamp = new GlideDateTime().getNumericValue();
    var sent = 0;
    for (var i = 0; i < EVENTS.length; i++) {
        var e = EVENTS[i];
        var ev = new GlideRecord('em_event');
        ev.initialize();
        ev.source = SOURCE;
        ev.node = e.node;
        ev.type = e.type;
        ev.resource = e.resource;
        ev.metric_name = e.metric;
        ev.severity = e.severity;
        ev.description = e.text;
        ev.message_key = SOURCE + '|' + e.node + '|' + e.resource + '#demo' + stamp;
        ev.time_of_event = minutesFromNow(-e.ago);
        // The web servers are application CIs, not hosts, so the node alone does not bind them.
        if (e.bindCi) { ev.cmdb_ci = byName('cmdb_ci', 'name', e.node); }
        if (ev.insert()) { sent++; }
    }
    check(sent == EVENTS.length, sent + ' events sent (closed ' + closed + ' old alerts and groups); the group appears in about 2 minutes');
    say(problems ? problems + ' item(s) to check.' : 'Open the newest alert group on SAP HANADB01 in about 3 minutes.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
