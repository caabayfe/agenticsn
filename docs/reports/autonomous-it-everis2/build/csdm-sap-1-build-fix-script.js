// Fix Script "AIT CSDM SAP 1 - build the SAP chain", Global scope, update set AIT-CSDM-SAP.
// Builds the CSDM chain for SAP S/4HANA production on the SAP demo hosts, so the alert impact
// agents can name the affected business and technology services. Safe to run again: every record
// is found by its business key first and created only when missing; existing records only get the
// fields that are empty. Run "AIT CSDM SAP 2 - check" afterwards.
// Demo data only: every record it creates carries [AIT-DEMO] in its description or comments. CIs
// and relationships are data, so the update set captures none of them; the revert script removes them.
(function() {
    var TAG = '[AIT-DEMO]';
    var SID = 'PRD';
    var log = [];
    var problems = 0;
    function say(line) { log.push(line); }
    function check(ok, line) { if (!ok) { problems++; } say((ok ? '  OK    ' : '  CHECK ') + line); }
    function byName(table, field, value) {
        var gr = new GlideRecord(table);
        return gr.get(field, value) ? gr.getUniqueValue() : '';
    }
    // Choice values are read from the instance by label, so a renamed or missing choice shows as
    // a CHECK line instead of a silent wrong value.
    function choice(table, element, label) {
        var tables = new GlideTableHierarchy(table).getTables();
        var c = new GlideRecord('sys_choice');
        c.addQuery('name', 'IN', tables.join(','));
        c.addQuery('element', element);
        c.addQuery('label', label);
        c.addQuery('inactive', false);
        c.setLimit(1);
        c.query();
        if (c.next()) { return c.getValue('value'); }
        check(false, 'no choice "' + label + '" for ' + table + '.' + element);
        return '';
    }
    // Sets only the fields that are empty: the script never overwrites what a person entered.
    function fillEmpty(gr, values) {
        var changed = false;
        for (var f in values) {
            if (values[f] !== '' && gr.isValidField(f) && gr.getValue(f) === null) {
                gr.setValue(f, values[f]);
                changed = true;
            }
        }
        return changed;
    }
    function ensure(table, key, values) {
        var gr = new GlideRecord(table);
        for (var k in key) { gr.addQuery(k, key[k]); }
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            if (fillEmpty(gr, values)) { gr.update(); }
            return { id: gr.getUniqueValue(), created: false };
        }
        gr.initialize();
        for (var k2 in key) { gr.setValue(k2, key[k2]); }
        fillEmpty(gr, values);
        return { id: gr.insert(), created: true };
    }
    var relTypes = {};
    function relType(name) {
        if (!relTypes[name]) { relTypes[name] = byName('cmdb_rel_type', 'name', name); }
        return relTypes[name];
    }
    var relCount = 0;
    function relate(parent, type, child) {
        if (!parent || !child || !relType(type)) {
            check(false, 'relationship ' + type + ' skipped: missing parent, child or type');
            return;
        }
        var r = ensure('cmdb_rel_ci', { parent: parent, child: child, type: relType(type) }, {});
        if (r.created) { relCount++; }
    }

    var group = {
        sap: byName('sys_user_group', 'name', 'DEMO.PI.SAP')
    };
    check(!!group.sap, 'group DEMO.PI.SAP exists (support and managing group of every SAP record)');
    var owner = byName('sys_user', 'user_name', 'abel.tuter');
    var prod = choice('cmdb_ci', 'environment', 'Production');
    var crit = choice('cmdb_ci_service', 'busines_criticality', '1 - most critical');
    var usedFor = choice('cmdb_ci_service', 'used_for', 'Production');
    var operational = choice('cmdb_ci', 'operational_status', 'Operational');
    var installed = choice('cmdb_ci', 'install_status', 'Installed');
    var common = {
        environment: prod, operational_status: operational, install_status: installed,
        support_group: group.sap, managed_by_group: group.sap, change_control: group.sap
    };

    // 1. The hosts: the SAP demo CIs already used by the alert scene. They are reused as they are;
    //    the script only fills empty ownership and environment fields. HANADB01 is the one new host.
    var hostNames = ['SAP LoadBal01', 'SAP WEB01', 'SAP WEB02', 'SAP WEB03', 'SAP WEB04',
        'SAP AppSRV01', 'SAP AppSRV02'];
    var hosts = {};
    for (var i = 0; i < hostNames.length; i++) {
        var h = new GlideRecord('cmdb_ci');
        if (h.get('name', hostNames[i])) {
            if (fillEmpty(h, common)) { h.update(); }
            hosts[hostNames[i]] = h.getUniqueValue();
        }
        check(!!hosts[hostNames[i]], 'host ' + hostNames[i] + (hosts[hostNames[i]] ? ' (' + h.getValue('sys_class_name') + ')' : ' is missing'));
    }

    // 2. The SAP software, through the IRE so it is identified like discovered data. The SAP classes
    //    are dependent: each one is identified with the host it runs on. The data source is the one
    //    the CSDM application service wizard uses (CSDMAppServiceHelper).
    var source = 'Manual Entry';
    function sapApp(className, values, hostName, hostTable) {
        values.short_description = TAG + ' ' + values.name;
        var payload = {
            items: [
                { className: className, values: values },
                { className: hostTable, values: { name: hostName } }
            ],
            relations: [{ parent: 0, child: 1, type: 'Runs on::Runs' }]
        };
        var out = JSON.parse(sn_cmdb.IdentificationEngine.createOrUpdateCI(source, JSON.stringify(payload)));
        var item = out.items && out.items[0];
        var ok = item && item.sysId && item.sysId != 'Unknown';
        check(ok, values.name + ' on ' + hostName + (ok ? ' (' + item.operation + ')' : ': ' + JSON.stringify(out.items && out.items[0] && out.items[0].errors)));
        if (!ok) { return ''; }
        var gr = new GlideRecord('cmdb_ci');
        if (gr.get(item.sysId) && fillEmpty(gr, common)) { gr.update(); }
        return item.sysId;
    }
    function hostClass(name) {
        var gr = new GlideRecord('cmdb_ci');
        return gr.get('name', name) ? gr.getValue('sys_class_name') : 'cmdb_ci_linux_server';
    }
    var hana = ensure('cmdb_ci_linux_server', { name: 'SAP HANADB01' }, {
        short_description: TAG + ' HANA database host of SAP S/4HANA PRD', os: 'SUSE Linux Enterprise Server',
        environment: prod, operational_status: operational, install_status: installed,
        support_group: group.sap, managed_by_group: group.sap, change_control: group.sap
    });
    hosts['SAP HANADB01'] = hana.id;
    check(!!hana.id, 'host SAP HANADB01 ' + (hana.created ? 'created' : 'exists'));

    var ascs = '', dialog = [], hdb = '';
    if (hosts['SAP AppSRV01']) {
        ascs = sapApp('cmdb_ci_appl_sap_ascs', { name: SID + ' ASCS01', sid: SID, instance_name: 'ASCS01', instance_number: '01' },
            'SAP AppSRV01', hostClass('SAP AppSRV01'));
    }
    var appServers = ['SAP AppSRV01', 'SAP AppSRV02'];
    for (var a = 0; a < appServers.length; a++) {
        if (!hosts[appServers[a]]) { continue; }
        var nr = a == 0 ? '00' : '10';
        var di = sapApp('cmdb_ci_appl_sap_di', { name: SID + ' D' + nr + ' ' + appServers[a].replace('SAP ', ''), sid: SID, instance_name: 'D' + nr, instance_number: nr },
            appServers[a], hostClass(appServers[a]));
        if (di) { dialog.push(di); }
    }
    // The HANA identification rule needs a pid; a fixed one keeps the record stable across runs.
    hdb = sapApp('cmdb_ci_appl_sap_hana_db', { name: 'HDB PRD', sid: 'HDB', instance: '00', pid: 30003 },
        'SAP HANADB01', 'cmdb_ci_linux_server');

    // 3. The technical topology, top-down as users reach it: load balancer, web dispatchers,
    //    dialog instances, then the message server (ASCS) and the database they need.
    var webs = ['SAP WEB01', 'SAP WEB02', 'SAP WEB03', 'SAP WEB04'];
    for (var w = 0; w < webs.length; w++) {
        relate(hosts['SAP LoadBal01'], 'Depends on::Used by', hosts[webs[w]]);
        for (var d = 0; d < dialog.length; d++) { relate(hosts[webs[w]], 'Depends on::Used by', dialog[d]); }
    }
    for (var d2 = 0; d2 < dialog.length; d2++) {
        relate(dialog[d2], 'Depends on::Used by', ascs);
        relate(dialog[d2], 'Depends on::Used by', hdb);
    }

    // 4. The application service, made the way the CSDM wizard makes it: a cmdb_ci_service_discovered
    //    whose members are manual entry points. The impact engine and the Alert Crawler read its members.
    var members = [hosts['SAP LoadBal01']].concat(webs.map(function(n) { return hosts[n]; }), dialog, [ascs, hdb],
        [hosts['SAP AppSRV01'], hosts['SAP AppSRV02'], hosts['SAP HANADB01']]).filter(function(x) { return !!x; });
    var svcName = 'SAP S/4HANA PRD';
    var svcId = byName('cmdb_ci_service_discovered', 'name', svcName);
    var svcBasics = {
        name: svcName, environment: prod, busines_criticality: crit, used_for: usedFor,
        operational_status: operational, support_group: group.sap, managed_by_group: group.sap,
        change_control: group.sap, owned_by: owner, version: '2023 FPS02',
        short_description: TAG + ' SAP S/4HANA production: sales orders, billing and finance for Spain'
    };
    var helper = new CSDMAppServiceHelper();
    var buildMethods = [];
    var cig = new GlideRecord('cmdb_ci');
    for (var m = 0; m < members.length; m++) {
        if (cig.get(members[m])) {
            buildMethods.push({ type: 'manual', ci_id: members[m], ci_label: cig.getValue('name'), class_name: cig.getValue('sys_class_name'), comments: TAG });
        }
    }
    if (!svcId) {
        // The CSDM relationships are made below with the rest of the chain, so none are passed here.
        var made = helper.createApplicationService({ basic_details: svcBasics, build_methods: buildMethods,
            relationships: { business_service_offering: [], technical_service_offering: [], business_app: [], parent_app_service: [] } });
        svcId = typeof made == 'string' ? made : '';
        check(!!svcId, 'application service ' + svcName + (svcId ? ' created with ' + buildMethods.length + ' members' : ': ' + JSON.stringify(made)));
    } else {
        say('  OK    application service ' + svcName + ' exists');
    }
    if (!svcId) {
        gs.print(log.join('\n'));
        return;
    }
    var assoc = new GlideAggregate('svc_ci_assoc');
    assoc.addQuery('service_id', svcId);
    assoc.addAggregate('COUNT');
    assoc.query();
    var memberCount = assoc.next() ? parseInt(assoc.getAggregate('COUNT'), 10) : 0;
    // A member missing here is added by hand in the service map (Add CI); the script does not rebuild maps.
    check(memberCount >= buildMethods.length, svcName + ' map holds ' + memberCount + ' CIs (expected ' + buildMethods.length + ' or more)');
    var svc = new GlideRecord('cmdb_ci_service_discovered');
    if (svc.get(svcId)) {
        var svcFill = fillEmpty(svc, svcBasics);
        // Severity is the service health the alert impact tool reads; empty makes the tool fail.
        if (svc.getValue('severity') === null) { svc.setValue('severity', choice('cmdb_ci_service_auto', 'severity', 'OK') || '5'); svcFill = true; }
        if (svcFill) { svc.update(); }
    }

    // 5. The business layer: what the business buys and the application behind it.
    var bizApp = ensure('cmdb_ci_business_app', { name: 'SAP S/4HANA' }, {
        short_description: TAG + ' ERP for order to cash, procure to pay and finance',
        business_criticality: choice('cmdb_ci_business_app', 'business_criticality', '1 - most critical'),
        it_application_owner: owner, owned_by: owner, support_group: group.sap, managed_by_group: group.sap,
        vendor: byName('core_company', 'name', 'SAP'), operational_status: operational
    });
    relate(bizApp.id, 'Consumes::Consumed by', svcId);

    var bizSvc = ensure('cmdb_ci_service_business', { name: 'Gestión de pedidos' }, {
        short_description: TAG + ' Order to cash: sales orders, deliveries and invoices for customers in Spain',
        service_classification: choice('cmdb_ci_service_business', 'service_classification', 'Business Service'),
        busines_criticality: crit, used_for: usedFor, owned_by: owner, support_group: group.sap,
        managed_by_group: group.sap, operational_status: operational
    });
    var offerings = [
        { name: 'Pedidos de venta - España', text: 'Create and change sales orders (VA01, Fiori Manage Sales Orders)' },
        { name: 'Facturación - España', text: 'Billing documents and invoices to customers' }
    ];
    var offeringIds = [];
    for (var o = 0; o < offerings.length; o++) {
        var off = ensure('service_offering', { name: offerings[o].name, parent: bizSvc.id }, {
            short_description: TAG + ' ' + offerings[o].text,
            service_classification: choice('service_offering', 'service_classification', 'Business Service'),
            busines_criticality: crit, used_for: usedFor, owned_by: owner, support_group: group.sap,
            managed_by_group: group.sap, operational_status: operational
        });
        relate(off.id, 'Depends on::Used by', svcId);
        offeringIds.push(off.id);
    }

    // 6. The technology layer: the SAP Basis team's service that runs the application.
    var techSvc = ensure('cmdb_ci_service_technical', { name: 'SAP Basis' }, {
        short_description: TAG + ' Run, patch and monitor the SAP landscape (kernel, transports, HANA)',
        service_classification: choice('cmdb_ci_service_technical', 'service_classification', 'Technical Service'),
        busines_criticality: crit, used_for: usedFor, owned_by: owner, support_group: group.sap,
        managed_by_group: group.sap, operational_status: operational
    });
    var techOff = ensure('service_offering', { name: 'SAP Basis - Producción', parent: techSvc.id }, {
        short_description: TAG + ' 24x7 operation of the SAP production systems',
        service_classification: choice('service_offering', 'service_classification', 'Technical Service'),
        busines_criticality: crit, used_for: usedFor, owned_by: owner, support_group: group.sap,
        managed_by_group: group.sap, operational_status: operational
    });
    relate(techOff.id, 'Contains::Contained by', svcId);

    // 7. The kernel change of scene 3.1 names the service it affects, so the change and the alert
    //    point to the same service.
    var chg = new GlideRecord('change_request');
    if (chg.get('number', 'CHG0030111')) {
        var aff = ensure('task_cmdb_ci_service', { task: chg.getUniqueValue(), cmdb_ci_service: svcId }, {});
        if (chg.getValue('business_service') === null) { chg.setValue('business_service', svcId); chg.update(); }
        check(true, 'CHG0030111 affects ' + svcName + (aff.created ? ' (added)' : ''));
    } else {
        check(false, 'CHG0030111 not found: scene 3.1 cites it');
    }

    say('');
    say('CSDM chain for SAP built. New relationships: ' + relCount + '.');
    say('  Business app SAP S/4HANA --Consumes--> ' + svcName);
    say('  Gestión de pedidos > ' + offerings.map(function(x) { return x.name; }).join(', ') + ' --Depends on--> ' + svcName);
    say('  SAP Basis > SAP Basis - Producción --Contains--> ' + svcName);
    say('  ' + svcName + ' members: ' + buildMethods.map(function(b) { return b.ci_label; }).join(', '));
    say('');
    say(problems ? problems + ' item(s) to check.' : 'Run "AIT CSDM SAP 2 - check" in two minutes, after the impact engine has read the service.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
