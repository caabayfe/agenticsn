// Fix Script "AIT CSDM SAP 9 - revert", Global scope.
// Removes what "AIT CSDM SAP 1 - build" created: only records carrying [AIT-DEMO] that it made, and
// the relationships between them. The SAP demo hosts it reused stay; the fields it filled on them
// stay too (they were empty before), and so do the four "SAP LoadBal01 depends on SAP WEB0n" links,
// which join two reused hosts. Set DRY_RUN to false to delete; the default only lists.
(function() {
    var DRY_RUN = true;
    var TAG = '[AIT-DEMO]';
    var log = [];
    function say(line) { log.push(line); }

    var ids = [];
    var ci = new GlideRecord('cmdb_ci');
    ci.addQuery('short_description', 'STARTSWITH', TAG);
    ci.addQuery('name', 'IN', ['SAP HANADB01', 'PRD DVEBMGS00 AppSRV01', 'PRD D10 AppSRV02', 'HDB PRD', 'SAP S/4HANA PRD',
        'SAP QASSRV01', 'QAS DVEBMGS00 QASSRV01', 'HDQ QAS', 'SAP S/4HANA QAS',
        'SAP S/4HANA', 'Gestión de pedidos', 'SAP Basis'].join(','));
    ci.query();
    while (ci.next()) { ids.push(ci.getUniqueValue()); say('  CI ' + ci.getValue('name') + ' (' + ci.getValue('sys_class_name') + ')'); }
    var off = new GlideRecord('service_offering');
    off.addQuery('short_description', 'STARTSWITH', TAG);
    off.query();
    while (off.next()) { ids.push(off.getUniqueValue()); say('  offering ' + off.getValue('name')); }

    var rel = new GlideRecord('cmdb_rel_ci');
    rel.addQuery('parent', 'IN', ids.join(',')).addOrCondition('child', 'IN', ids.join(','));
    rel.query();
    say('  ' + rel.getRowCount() + ' relationships');
    var impacted = new GlideRecord('task_cmdb_ci_service');
    impacted.addQuery('cmdb_ci_service', 'IN', ids.join(','));
    impacted.query();
    say('  ' + impacted.getRowCount() + ' affected-service rows on changes');

    if (!DRY_RUN) {
        rel.deleteMultiple();
        impacted.deleteMultiple();
        // The application service goes through its own delete so its map and entry points go too.
        for (var i = 0; i < ids.length; i++) {
            var gr = new GlideRecord('cmdb_ci');
            if (gr.get(ids[i])) { gr.deleteRecord(); }
            else {
                var o = new GlideRecord('service_offering');
                if (o.get(ids[i])) { o.deleteRecord(); }
            }
        }
        say('Deleted ' + ids.length + ' records.');
    } else {
        say('Dry run: nothing deleted. Set DRY_RUN = false to delete the records above.');
    }
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
