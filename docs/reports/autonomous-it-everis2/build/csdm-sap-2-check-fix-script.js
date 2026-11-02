// Fix Script "AIT CSDM SAP 2 - check", Global scope. Read-only: it changes nothing.
// Checks every link the alert impact agents follow, in their order, and says which scene is ready:
// alert -> CI -> impact graph -> application service -> offerings and services -> recent incidents.
(function() {
    var log = [];
    var problems = 0;
    function say(line) { log.push(line); }
    function check(ok, line) { if (!ok) { problems++; } say((ok ? '  OK    ' : '  CHECK ') + line); }
    function count(table, query) {
        var ga = new GlideAggregate(table);
        if (!ga.isValid()) { return -1; }
        ga.addEncodedQuery(query);
        ga.addAggregate('COUNT');
        ga.query();
        return ga.next() ? parseInt(ga.getAggregate('COUNT'), 10) : 0;
    }
    function named(table, name) {
        var gr = new GlideRecord(table);
        return gr.get('name', name) ? gr : null;
    }

    var svc = named('cmdb_ci_service_discovered', 'SAP S/4HANA PRD');
    check(!!svc, 'application service SAP S/4HANA PRD exists');
    if (!svc) { gs.print(log.join('\n')); return; }
    var svcId = svc.getUniqueValue();
    check(svc.getValue('severity') !== null, 'service severity is set (the impact tool fails on an empty one): ' + svc.getDisplayValue('severity'));
    check(count('svc_ci_assoc', 'service_id=' + svcId) >= 10, 'service map members: ' + count('svc_ci_assoc', 'service_id=' + svcId));

    var app = named('cmdb_ci', 'SAP AppSRV01');
    var graph = app ? count('em_impact_graph', 'child_id=' + app.getUniqueValue() + '^business_service=' + svcId) : 0;
    // The impact engine builds this from the map; without it the alert names no service.
    check(graph > 0, 'impact graph links SAP AppSRV01 to the service: ' + graph + ' row(s)');

    // The business impact tool takes only these parent classes, through Depends on or Contains.
    var rel = new GlideRecord('cmdb_rel_ci');
    rel.addQuery('child', svcId);
    rel.addQuery('parent.sys_class_name', 'IN', 'service_offering,cmdb_ci_service_business,cmdb_ci_service_technical,cmdb_ci_business_app');
    rel.query();
    var parents = [];
    while (rel.next()) { parents.push(rel.parent.getDisplayValue() + ' (' + rel.type.getDisplayValue() + ')'); }
    check(parents.length >= 4, 'CSDM parents of the service: ' + parents.join('; '));

    // The newest SAP demo alert: does the Alert Crawler already list the service as impacted?
    var alert = new GlideRecord('em_alert');
    alert.addQuery('source', 'AIT-Demo');
    alert.addQuery('state', '!=', 'Closed');
    alert.orderByDesc('sys_created_on');
    alert.setLimit(1);
    alert.query();
    if (alert.next()) {
        var listed = count('sn_em_ai_alert_services', 'alert=' + alert.getUniqueValue() + '^business_service=' + svcId);
        check(listed > 0, alert.getValue('number') + ' (' + alert.cmdb_ci.getDisplayValue() + ') lists SAP S/4HANA PRD as impacted: ' + listed);
        var since = alert.getValue('initial_remote_time') || alert.getValue('sys_created_on');
        var reports = count('incident', 'service_offering.nameSTARTSWITHPedidos de venta^sys_created_on>=' + since + '^sys_created_byNOT INadmin,system');
        check(reports > 0, 'employee incidents on "Pedidos de venta - España" since the alert (user impact agent): ' + reports + ' (run "AIT CSDM SAP 3 - user reports")');
    } else {
        check(false, 'no open AIT-Demo alert: run "AIT demo 1 - prepare (day before)" first');
    }

    var chg = new GlideRecord('change_request');
    check(chg.get('number', 'CHG0030111') && count('task_cmdb_ci_service', 'task=' + chg.getUniqueValue() + '^cmdb_ci_service=' + svcId) > 0,
        'CHG0030111 lists SAP S/4HANA PRD as an affected service');

    say('');
    say(problems ? problems + ' item(s) to check.' : 'The SAP chain is ready for Act 3.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
