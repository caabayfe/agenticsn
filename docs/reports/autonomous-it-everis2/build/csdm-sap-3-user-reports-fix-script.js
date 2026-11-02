// Fix Script "AIT CSDM SAP 3 - user reports", Global scope, update set AIT-CSDM-SAP.
// Run it right after "AIT demo 1 - prepare (day before)". It files what employees reported while the
// SAP outage of scene 3.1 was going on: two incidents on the offering "Pedidos de venta - España",
// a few minutes after the newest SAP demo alert. The user impact agent counts only incidents filed
// by people (not admin or system) within two hours of the alert, so the records carry the callers as
// creators and the alert's time as their creation time. Safe to run again: it resolves its previous
// copies first.
(function() {
    var TAG = '[AIT-DEMO] user report';
    var log = [];
    var problems = 0;
    function say(line) { log.push(line); }
    function check(ok, line) { if (!ok) { problems++; } say((ok ? '  OK    ' : '  CHECK ') + line); }
    function byName(table, field, value) {
        var gr = new GlideRecord(table);
        return gr.get(field, value) ? gr.getUniqueValue() : '';
    }

    var old = new GlideRecord('incident');
    old.addActiveQuery();
    old.addQuery('description', 'CONTAINS', TAG);
    old.query();
    var retired = 0;
    while (old.next()) {
        old.state = 6;
        old.close_code = 'Resolved by caller';
        old.close_notes = 'Demo copy retired before a new demo run.';
        old.update();
        retired++;
    }

    var alert = new GlideRecord('em_alert');
    alert.addQuery('source', 'AIT-Demo');
    alert.addQuery('state', '!=', 'Closed');
    alert.orderByDesc('sys_created_on');
    alert.setLimit(1);
    alert.query();
    if (!alert.next()) {
        check(false, 'no open AIT-Demo alert: run "AIT demo 1 - prepare (day before)" first');
        gs.print(log.join('\n'));
        return;
    }
    var start = new GlideDateTime(alert.getValue('initial_remote_time') || alert.getValue('sys_created_on'));

    var svcId = byName('cmdb_ci_service_discovered', 'name', 'SAP S/4HANA PRD');
    var offering = byName('service_offering', 'name', 'Pedidos de venta - España');
    check(!!svcId && !!offering, 'SAP S/4HANA PRD and its offering exist (run "AIT CSDM SAP 1 - build" first)');
    var reports = [
        { user: 'abel.tuter', minutes: 4, short: 'No puedo guardar pedidos de venta en SAP',
          text: 'Al guardar el pedido en VA01 se queda pensando y sale "error de actualización V1". Llevo tres clientes esperando.' },
        { user: 'adela.cervantsz', minutes: 7, short: 'SAP muy lento al crear pedidos y facturas',
          text: 'Desde hace unos minutos SAP tarda más de un minuto en cada pantalla y la factura no se genera.' }
    ];
    var made = [];
    for (var i = 0; i < reports.length; i++) {
        var r = reports[i];
        var caller = byName('sys_user', 'user_name', r.user);
        if (!caller) { check(false, 'caller ' + r.user + ' not found'); continue; }
        var when = new GlideDateTime(start);
        when.addSeconds(r.minutes * 60);
        var inc = new GlideRecord('incident');
        inc.initialize();
        inc.caller_id = caller;
        inc.short_description = r.short;
        inc.description = r.text + '\n\n' + TAG;
        inc.business_service = svcId;
        inc.service_offering = offering;
        inc.contact_type = 'self-service';
        inc.impact = 2;
        inc.urgency = 2;
        // The creator and the time are what the user impact agent filters on.
        inc.autoSysFields(false);
        inc.sys_created_by = r.user;
        inc.sys_updated_by = r.user;
        inc.sys_created_on = when;
        inc.sys_updated_on = when;
        if (inc.insert()) { made.push(inc.getValue('number') + ' (' + r.user + ', +' + r.minutes + ' min)'); }
    }
    check(made.length == reports.length, 'user reports for ' + alert.getValue('number') + ': ' + made.join('; '));
    say('Retired ' + retired + ' previous copies.');
    say(problems ? problems + ' item(s) to check.' : 'Ready: the impact analysis on the SAP alert will cite these reports.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
