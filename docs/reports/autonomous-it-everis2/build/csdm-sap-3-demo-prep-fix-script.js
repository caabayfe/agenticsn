// Fix Script "AIT CSDM SAP 3 - demo prep", Global scope, update set AIT-CSDM-SAP.
// Run it right after "AIT demo 1 - prepare (day before)", which sends the SAP PRD events. It adds the
// two things the impact scene compares:
// 1. The same symptom on the quality system: one event on SAP QASSRV01 (source AIT-Demo-QAS, so
//    "AIT demo 1" never copies or closes it). Its impact analysis finds no business offering.
// 2. What employees reported during the PRD outage: two incidents on "Pedidos de venta - España",
//    4 and 7 minutes after the newest PRD alert. The user impact agent counts only incidents filed by
//    people (not admin or system) within two hours of the alert, so the records carry the callers as
//    creators and the alert's time as their creation time.
// Safe to run again: it closes its previous QAS alerts and resolves its previous reports first.
(function() {
    var TAG = '[AIT-DEMO] user report';
    var QAS_SOURCE = 'AIT-Demo-QAS';
    var log = [];
    var problems = 0;
    function say(line) { log.push(line); }
    function check(ok, line) { if (!ok) { problems++; } say((ok ? '  OK    ' : '  CHECK ') + line); }
    function byName(table, field, value) {
        var gr = new GlideRecord(table);
        return gr.get(field, value) ? gr.getUniqueValue() : '';
    }
    var prdId = byName('cmdb_ci_service_discovered', 'name', 'SAP S/4HANA PRD');
    var qasHost = byName('cmdb_ci', 'name', 'SAP QASSRV01');
    var offering = byName('service_offering', 'name', 'Pedidos de venta - España');
    check(!!prdId && !!qasHost && !!offering, 'the SAP model exists (run "AIT CSDM SAP 1 - build" first)');

    // 1. The QAS event: the same work process restarts as the PRD outage, on the quality host.
    var oldQas = new GlideRecord('em_alert');
    oldQas.addQuery('source', QAS_SOURCE);
    oldQas.addQuery('state', '!=', 'Closed');
    oldQas.query();
    var closed = 0;
    while (oldQas.next()) {
        oldQas.state = 'Closed';
        oldQas.update();
        closed++;
    }
    if (qasHost) {
        var ev = new GlideRecord('em_event');
        ev.initialize();
        ev.source = QAS_SOURCE;
        // Same type and metric as the PRD event on SAP AppSRV01, so only the CMDB tells them apart.
        ev.node = 'SAP QASSRV01';
        ev.type = 'Application';
        ev.resource = 'QAS dispatcher';
        ev.metric_name = 'sap_wp_restarts';
        ev.severity = 2;
        ev.description = 'QAS dispatcher: dialog work processes restarted 6 times in 10 minutes; update requests (V1) waiting.';
        ev.message_key = 'AIT-Demo-QAS|SAP QASSRV01|QAS dispatcher#demo' + new GlideDateTime().getNumericValue();
        ev.time_of_event = new GlideDateTime();
        check(!!ev.insert(), 'QAS event sent on SAP QASSRV01 (closed ' + closed + ' old QAS alerts); its alert appears in about 1 minute');
    }

    // 2. The employees' reports on the PRD outage.
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
    } else {
        var start = new GlideDateTime(alert.getValue('initial_remote_time') || alert.getValue('sys_created_on'));
        var reports = [
            { user: 'abel.tuter', minutes: 4, summary: 'No puedo guardar pedidos de venta en SAP',
              text: 'Al guardar el pedido en VA01 se queda pensando y sale "error de actualización V1". Llevo tres clientes esperando.' },
            { user: 'adela.cervantsz', minutes: 7, summary: 'SAP muy lento al crear pedidos y facturas',
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
            inc.short_description = r.summary;
            inc.description = r.text + '\n\n' + TAG;
            inc.business_service = prdId;
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
        check(made.length == reports.length, 'user reports for ' + alert.getValue('number') + ' on ' + alert.cmdb_ci.getDisplayValue() + ': ' + made.join('; '));
    }
    say('Retired ' + retired + ' previous reports.');
    say(problems ? problems + ' item(s) to check.' : 'Ready: run "AIT CSDM SAP 2 - check" in two minutes.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
