// Fix Script "AIT demo 2 - start SLA clock (live)", Global scope, update set AIT-P2-demo-prep.
// Optional, for a live scene 2.5. Run it at the start of Act 2: it opens an [AIT-P1] incident in
// DEMO.PI.Workplace, which starts the 12-minute demo SLA, and moves it to DEMO.PI.SAP 3 minutes later
// (case R1 of pilot 1). The autonomous note arrives about 9.5 minutes after the run; the SLA breaches
// at 12 minutes. Data only: it changes no configuration.
(function() {
    function byName(table, field, value) {
        var gr = new GlideRecord(table);
        return gr.get(field, value) ? gr.getUniqueValue() : '';
    }
    var sap = byName('sys_user_group', 'name', 'DEMO.PI.SAP');
    var inc = new GlideRecord('incident');
    inc.initialize();
    inc.short_description = '[AIT-P1] SAP: los pedidos de venta no se guardan';
    inc.description = 'Desde esta mañana los pedidos de venta (VA01) dan error al guardar.';
    inc.caller_id = byName('sys_user', 'user_name', 'abel.tuter');
    inc.assignment_group = byName('sys_user_group', 'name', 'DEMO.PI.Workplace');
    inc.impact = 2;
    inc.urgency = 2;
    if (!inc.insert()) {
        gs.print('The incident was not created.');
        return;
    }
    var at = new GlideDateTime();
    at.addSeconds(180);
    var move = new ScheduleOnce();
    move.script = "var i = new GlideRecord('incident'); if (i.get('" + inc.getUniqueValue() + "')) { " +
        "i.assignment_group = '" + sap + "'; i.update(); }";
    move.setTime(at);
    move.setLabel('AIT demo: move ' + inc.getValue('number') + ' to DEMO.PI.SAP');
    move.schedule();
    var text = 'Clock started: ' + inc.getValue('number') + '. It moves to DEMO.PI.SAP at ' +
        at.getDisplayValue() + '; the autonomous note arrives about 9.5 minutes after now.';
    gs.info(text);
    gs.print(text);
})();
