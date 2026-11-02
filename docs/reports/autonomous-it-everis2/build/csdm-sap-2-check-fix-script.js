// Fix Script "AIT CSDM SAP 2 - check", Global scope. Read-only: it changes nothing.
// Checks every link the alert impact agents follow, in their order, for both SAP installations:
// alert -> CI -> impact graph -> application service -> offerings and services -> recent incidents.
// PRD must reach the business offerings; QAS must reach only the non-production Basis offering.
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
    function newestAlert(source) {
        var gr = new GlideRecord('em_alert');
        gr.addQuery('source', source);
        gr.addQuery('state', '!=', 'Closed');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr : null;
    }
    // The CSDM parents the business impact tool reads: these classes only, through Depends on or Contains.
    function parentsOf(svcId) {
        var rel = new GlideRecord('cmdb_rel_ci');
        rel.addQuery('child', svcId);
        rel.addQuery('parent.sys_class_name', 'IN', 'service_offering,cmdb_ci_service_business,cmdb_ci_service_technical,cmdb_ci_business_app');
        rel.query();
        var out = [];
        while (rel.next()) { out.push({ name: rel.parent.getDisplayValue(), type: rel.type.getDisplayValue() }); }
        return out;
    }

    function checkService(name, host, source, expected) {
        say(name + ':');
        var svc = named('cmdb_ci_service_discovered', name);
        check(!!svc, 'application service exists');
        if (!svc) { return null; }
        var svcId = svc.getUniqueValue();
        check(svc.getValue('severity') !== null, 'severity is set (the impact tool fails on an empty one): ' + svc.getDisplayValue('severity'));
        var members = count('svc_ci_assoc', 'service_id=' + svcId);
        check(members >= expected.members, 'service map members: ' + members + ' (expected ' + expected.members + ')');
        var hostRec = named('cmdb_ci', host);
        // The impact engine builds this from the map; without it the alert names no service.
        var graph = hostRec ? count('em_impact_graph', 'child_id=' + hostRec.getUniqueValue() + '^business_service=' + svcId) : 0;
        check(graph > 0, 'impact graph links ' + host + ' to the service: ' + graph + ' row(s)');
        var parents = parentsOf(svcId);
        var names = parents.map(function(p) { return p.name; });
        say('        parents: ' + parents.map(function(p) { return p.name + ' (' + p.type + ')'; }).join('; '));
        for (var i = 0; i < expected.parents.length; i++) {
            check(names.indexOf(expected.parents[i]) >= 0, 'linked to ' + expected.parents[i]);
        }
        for (var j = 0; j < expected.notParents.length; j++) {
            check(names.indexOf(expected.notParents[j]) < 0, 'not linked to ' + expected.notParents[j]);
        }
        var alert = newestAlert(source);
        if (!alert) {
            check(false, 'no open ' + source + ' alert: run the demo prep scripts first');
            return null;
        }
        var listed = count('sn_em_ai_alert_services', 'alert=' + alert.getUniqueValue() + '^business_service=' + svcId);
        check(listed > 0, alert.getValue('number') + ' (' + alert.cmdb_ci.getDisplayValue() + ') lists the service as impacted');
        return alert;
    }

    var bizOfferings = ['Pedidos de venta - España', 'Facturación - España'];
    var prdAlert = checkService('SAP S/4HANA PRD', 'SAP AppSRV01', 'AIT-Demo', {
        members: 12, parents: ['SAP S/4HANA', 'SAP Basis - Producción'].concat(bizOfferings), notParents: ['SAP Basis - No productivo']
    });
    if (prdAlert) {
        var since = prdAlert.getValue('initial_remote_time') || prdAlert.getValue('sys_created_on');
        var reports = count('incident', 'service_offering.name=Pedidos de venta - España^sys_created_on>=' + since + '^sys_created_byNOT INadmin,system');
        check(reports > 0, 'employee incidents on "Pedidos de venta - España" since the alert (user impact agent): ' + reports);
    }
    var chg = new GlideRecord('change_request');
    var prd = named('cmdb_ci_service_discovered', 'SAP S/4HANA PRD');
    check(!!prd && chg.get('number', 'CHG0030111') && count('task_cmdb_ci_service', 'task=' + chg.getUniqueValue() + '^cmdb_ci_service=' + prd.getUniqueValue()) > 0,
        'CHG0030111 lists SAP S/4HANA PRD as an affected service');
    say('');
    checkService('SAP S/4HANA QAS', 'SAP QASSRV01', 'AIT-Demo-QAS', {
        members: 4, parents: ['SAP S/4HANA', 'SAP Basis - No productivo'], notParents: bizOfferings.concat(['SAP Basis - Producción'])
    });

    say('');
    say(problems ? problems + ' item(s) to check.' : 'The SAP model is ready for Act 3.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
