// Fix Script "AIT CSDM SAP 1 - build the SAP chain", Global scope, update set AIT-CSDM-SAP.
// Builds the CSDM model of SAP S/4HANA: one business application with two application services,
// production (PRD, on the SAP demo hosts) and quality (QAS, on one new host). Only PRD carries
// business offerings, so the alert impact agents find business impact on PRD and none on QAS.
// Safe to run again: every record is found by its business key first and created only when missing;
// existing records only get the fields that are empty. Run "AIT CSDM SAP 2 - check" afterwards.
// Demo data only: every record it creates carries [AIT-DEMO] in its description. CIs and
// relationships are data, so the update set captures none of them; the revert script removes them.
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
    // Choice values are read from the instance by label (the first label that exists wins), so a
    // renamed or missing choice shows as a CHECK line instead of a silent wrong value.
    function choice(table, element, labels) {
        // Global scope has TableUtils, not GlideTableHierarchy; it returns a Java list.
        var list = new TableUtils(table).getTables();
        var tables = [];
        for (var t = 0; t < list.size(); t++) { tables.push('' + list.get(t)); }
        for (var i = 0; i < labels.length; i++) {
            var c = new GlideRecord('sys_choice');
            c.addQuery('name', 'IN', tables.join(','));
            c.addQuery('element', element);
            c.addQuery('label', labels[i]);
            c.addQuery('inactive', false);
            c.setLimit(1);
            c.query();
            if (c.next()) { return c.getValue('value'); }
        }
        check(false, 'no choice "' + labels.join('" or "') + '" for ' + table + '.' + element);
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
    function merge(a, b) {
        var out = {};
        for (var x in a) { out[x] = a[x]; }
        for (var y in b) { out[y] = b[y]; }
        return out;
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
        if (ensure('cmdb_rel_ci', { parent: parent, child: child, type: relType(type) }, {}).created) { relCount++; }
    }

    var sapGroup = byName('sys_user_group', 'name', 'DEMO.PI.SAP');
    check(!!sapGroup, 'group DEMO.PI.SAP exists (support, managing and change group of every SAP record)');
    var owner = byName('sys_user', 'user_name', 'abel.tuter');
    // The CIs take the owner of the SAP servers already on the instance, so the incident note names a person.
    var sapServer = new GlideRecord('cmdb_ci');
    var ciOwner = sapServer.get('name', 'SAP AppSRV01') ? (sapServer.getValue('owned_by') || '') : '';
    var operational = choice('cmdb_ci', 'operational_status', ['Operational']);
    var installed = choice('cmdb_ci', 'install_status', ['Installed']);
    var groups = { support_group: sapGroup, managed_by_group: sapGroup, change_control: sapGroup, operational_status: operational };

    // The two environments. PRD reuses the SAP demo hosts of the alert scene; QAS is the usual small
    // all-in-one quality system on one host.
    var ENVS = [{
        sid: 'PRD', service: 'SAP S/4HANA PRD', version: '2023 FPS02',
        text: 'SAP S/4HANA production: sales orders, billing and finance for Spain',
        environment: ['Production'], usedFor: ['Production'], criticality: ['1 - most critical'],
        reusedHosts: ['SAP LoadBal01', 'SAP WEB01', 'SAP WEB02', 'SAP WEB03', 'SAP WEB04', 'SAP AppSRV01', 'SAP AppSRV02'],
        newHosts: [{ name: 'SAP HANADB01', text: 'HANA database host of SAP S/4HANA PRD' }],
        // The central instance matches the PRD events, which name /usr/sap/PRD/DVEBMGS00 on SAP AppSRV01.
        instances: [{ host: 'SAP AppSRV01', name: 'DVEBMGS00', nr: '00', central: true }, { host: 'SAP AppSRV02', name: 'D10', nr: '10' }],
        hana: { sid: 'HDB', host: 'SAP HANADB01', pid: 30003 },
        loadBalancer: 'SAP LoadBal01', webs: ['SAP WEB01', 'SAP WEB02', 'SAP WEB03', 'SAP WEB04'],
        techOffering: { name: 'SAP Basis - Producción', text: '24x7 operation of the SAP production systems' }
    }, {
        sid: 'QAS', service: 'SAP S/4HANA QAS', version: '2023 FPS02',
        text: 'SAP S/4HANA quality system: transport and release tests before production',
        environment: ['QA', 'Test'], usedFor: ['QA', 'Test'], criticality: ['3 - less critical'],
        reusedHosts: [],
        newHosts: [{ name: 'SAP QASSRV01', text: 'All-in-one host of SAP S/4HANA QAS (central instance and HANA)' }],
        instances: [{ host: 'SAP QASSRV01', name: 'DVEBMGS00', nr: '00', central: true }],
        hana: { sid: 'HDQ', host: 'SAP QASSRV01', pid: 30013 },
        loadBalancer: '', webs: [],
        techOffering: { name: 'SAP Basis - No productivo', text: 'Office-hours operation of the SAP quality and development systems' }
    }];

    // The SAP software goes through the IRE so it is identified like discovered data. The SAP classes
    // are dependent: each one is identified with the host it runs on. The data source is the one the
    // CSDM application service wizard uses (CSDMAppServiceHelper).
    function sapApp(className, values, hostName, hostTable, fields) {
        values.short_description = TAG + ' ' + values.name;
        var payload = {
            items: [{ className: className, values: values }, { className: hostTable, values: { name: hostName } }],
            relations: [{ parent: 0, child: 1, type: 'Runs on::Runs' }]
        };
        var out = JSON.parse(sn_cmdb.IdentificationEngine.createOrUpdateCI('Manual Entry', JSON.stringify(payload)));
        var item = out.items && out.items[0];
        var ok = !!item && !!item.sysId && item.sysId != 'Unknown';
        check(ok, values.name + ' on ' + hostName + (ok ? ' (' + item.operation + ')' : ': ' + JSON.stringify(item && item.errors)));
        if (!ok) { return ''; }
        var gr = new GlideRecord('cmdb_ci');
        if (gr.get(item.sysId) && fillEmpty(gr, fields)) { gr.update(); }
        return item.sysId;
    }
    function ciClass(id) {
        var gr = new GlideRecord('cmdb_ci');
        return gr.get(id) ? gr.getValue('sys_class_name') : '';
    }

    // Builds one environment: hosts, SAP software, topology and the application service.
    function buildEnvironment(env) {
        var fields = merge(groups, {
            environment: choice('cmdb_ci', 'environment', env.environment), install_status: installed, owned_by: ciOwner
        });
        var hosts = {};
        for (var i = 0; i < env.reusedHosts.length; i++) {
            var h = new GlideRecord('cmdb_ci');
            var found = h.get('name', env.reusedHosts[i]);
            if (found) {
                if (fillEmpty(h, fields)) { h.update(); }
                hosts[env.reusedHosts[i]] = h.getUniqueValue();
            }
            check(found, env.sid + ' host ' + env.reusedHosts[i] + (found ? ' (' + h.getValue('sys_class_name') + ')' : ' is missing'));
        }
        for (var n = 0; n < env.newHosts.length; n++) {
            var made = ensure('cmdb_ci_linux_server', { name: env.newHosts[n].name },
                merge(fields, { short_description: TAG + ' ' + env.newHosts[n].text, os: 'SUSE Linux Enterprise Server' }));
            hosts[env.newHosts[n].name] = made.id;
            check(!!made.id, env.sid + ' host ' + env.newHosts[n].name + (made.created ? ' created' : ' exists'));
        }

        // The central instance (DVEBMGS: dialog, update, enqueue, message server) and any further dialog
        // instances, each on its host.
        var central = '';
        var dialogs = [];
        for (var d = 0; d < env.instances.length; d++) {
            var inst = env.instances[d];
            if (!hosts[inst.host]) { continue; }
            var id = sapApp(inst.central ? 'cmdb_ci_appl_sap_ci' : 'cmdb_ci_appl_sap_di',
                { name: env.sid + ' ' + inst.name + ' ' + inst.host.replace('SAP ', ''), sid: env.sid, instance_name: inst.name, instance_number: inst.nr },
                inst.host, ciClass(hosts[inst.host]), fields);
            if (!id) { continue; }
            if (inst.central) { central = id; }
            dialogs.push(id);
        }
        // The HANA identification rule needs a pid; a fixed one keeps the record stable across runs.
        var hana = hosts[env.hana.host] ? sapApp('cmdb_ci_appl_sap_hana_db',
            { name: env.hana.sid + ' ' + env.sid, sid: env.hana.sid, instance: '00', pid: env.hana.pid },
            env.hana.host, ciClass(hosts[env.hana.host]), fields) : '';

        // The technical topology, top-down as users reach it: load balancer, web servers, SAP instances,
        // then the central instance's message server and the database they need.
        for (var w = 0; w < env.webs.length; w++) {
            relate(hosts[env.loadBalancer], 'Depends on::Used by', hosts[env.webs[w]]);
            for (var x = 0; x < dialogs.length; x++) { relate(hosts[env.webs[w]], 'Depends on::Used by', dialogs[x]); }
        }
        for (var y = 0; y < dialogs.length; y++) {
            if (dialogs[y] != central) { relate(dialogs[y], 'Depends on::Used by', central); }
            relate(dialogs[y], 'Depends on::Used by', hana);
        }

        // The application service, made the way the CSDM wizard makes it: a cmdb_ci_service_discovered
        // whose members are manual entry points. The impact engine and the Alert Crawler read its members.
        var members = [];
        for (var hn in hosts) { if (hosts[hn]) { members.push(hosts[hn]); } }
        members = members.concat(dialogs, [hana]).filter(function(id) { return !!id; });
        var basics = merge(groups, {
            name: env.service, environment: fields.environment, used_for: choice('cmdb_ci_service', 'used_for', env.usedFor),
            busines_criticality: choice('cmdb_ci_service', 'busines_criticality', env.criticality),
            owned_by: owner, version: env.version, short_description: TAG + ' ' + env.text
        });
        var buildMethods = [];
        var m = new GlideRecord('cmdb_ci');
        for (var k = 0; k < members.length; k++) {
            if (m.get(members[k])) {
                buildMethods.push({ type: 'manual', ci_id: members[k], ci_label: m.getValue('name'), class_name: m.getValue('sys_class_name'), comments: TAG });
            }
        }
        var svcId = byName('cmdb_ci_service_discovered', 'name', env.service);
        if (!svcId) {
            // The CSDM relationships are made by the caller with the rest of the chain, so none are passed here.
            var res = new CSDMAppServiceHelper().createApplicationService({ basic_details: basics, build_methods: buildMethods,
                relationships: { business_service_offering: [], technical_service_offering: [], business_app: [], parent_app_service: [] } });
            svcId = typeof res == 'string' ? res : '';
            check(!!svcId, 'application service ' + env.service + (svcId ? ' created' : ': ' + JSON.stringify(res)));
        } else {
            say('  OK    application service ' + env.service + ' exists');
        }
        if (!svcId) { return null; }
        var svc = new GlideRecord('cmdb_ci_service_discovered');
        if (svc.get(svcId)) {
            var changed = fillEmpty(svc, basics);
            // Severity is the service health the alert impact tool reads; empty makes the tool fail.
            if (svc.getValue('severity') === null) {
                svc.setValue('severity', choice('cmdb_ci_service_auto', 'severity', ['OK', 'Clear']) || '5');
                changed = true;
            }
            if (changed) { svc.update(); }
        }
        var assoc = new GlideAggregate('svc_ci_assoc');
        assoc.addQuery('service_id', svcId);
        assoc.addAggregate('COUNT');
        assoc.query();
        var inMap = assoc.next() ? parseInt(assoc.getAggregate('COUNT'), 10) : 0;
        // A member missing here is added by hand in the service map (Add CI); the script does not rebuild maps.
        check(inMap >= buildMethods.length, env.service + ' map holds ' + inMap + ' CIs (expected ' + buildMethods.length + ' or more): ' +
            buildMethods.map(function(b) { return b.ci_label; }).join(', '));
        return { id: svcId, fields: fields, criticality: basics.busines_criticality, usedFor: basics.used_for };
    }

    var built = {};
    for (var e = 0; e < ENVS.length; e++) {
        say(ENVS[e].sid + ':');
        built[ENVS[e].sid] = buildEnvironment(ENVS[e]);
    }
    if (!built.PRD || !built.QAS) {
        say('Stopped before the business layer: an application service is missing.');
        gs.print(log.join('\n'));
        return;
    }
    var prd = built.PRD;
    var top = merge(groups, { owned_by: owner, busines_criticality: prd.criticality, used_for: prd.usedFor });
    say('CSDM layers:');

    // The business application: one product, consumed by both installations. everis2 refuses a
    // business application without an application category (business rule "Check if Application
    // Category is empty"); the other SAP applications there use Finance, Sales and Sourcing.
    var category = '';
    var categories = ['Enterprise Resource Planning', 'ERP', 'Finance'];
    for (var c = 0; c < categories.length && !category; c++) { category = byName('apm_application_category', 'name', categories[c]); }
    check(!!category, 'application category for SAP S/4HANA found');
    var bizApp = ensure('cmdb_ci_business_app', { name: 'SAP S/4HANA' }, merge(groups, {
        short_description: TAG + ' ERP for order to cash, procure to pay and finance',
        application_category: category,
        application_type: choice('cmdb_ci_business_app', 'application_type', ['COTS']),
        business_criticality: choice('cmdb_ci_business_app', 'business_criticality', ['High', 'Alto']),
        it_application_owner: owner, owned_by: owner, vendor: byName('core_company', 'name', 'SAP')
    }));
    check(!!bizApp.id, 'business application SAP S/4HANA ' + (bizApp.created ? 'created' : 'exists'));
    relate(bizApp.id, 'Consumes::Consumed by', built.PRD.id);
    relate(bizApp.id, 'Consumes::Consumed by', built.QAS.id);

    // The business layer depends on production only: nobody sells through the quality system.
    var bizSvc = ensure('cmdb_ci_service_business', { name: 'Gestión de pedidos' }, merge(top, {
        short_description: TAG + ' Order to cash: sales orders, deliveries and invoices for customers in Spain',
        service_classification: choice('cmdb_ci_service_business', 'service_classification', ['Business Service'])
    }));
    var offerings = [
        { name: 'Pedidos de venta - España', text: 'Create and change sales orders (VA01, Fiori Manage Sales Orders)' },
        { name: 'Facturación - España', text: 'Billing documents and invoices to customers' }
    ];
    for (var o = 0; o < offerings.length; o++) {
        var off = ensure('service_offering', { name: offerings[o].name, parent: bizSvc.id }, merge(top, {
            short_description: TAG + ' ' + offerings[o].text,
            service_classification: choice('service_offering', 'service_classification', ['Business Service'])
        }));
        relate(off.id, 'Depends on::Used by', built.PRD.id);
    }

    // The technology layer: the SAP Basis team runs both, with one offering per kind of environment.
    var techSvc = ensure('cmdb_ci_service_technical', { name: 'SAP Basis' }, merge(top, {
        short_description: TAG + ' Run, patch and monitor the SAP landscape (kernel, transports, HANA)',
        service_classification: choice('cmdb_ci_service_technical', 'service_classification', ['Technology Management Service', 'Technical Service'])
    }));
    for (var t = 0; t < ENVS.length; t++) {
        var env = built[ENVS[t].sid];
        var techOff = ensure('service_offering', { name: ENVS[t].techOffering.name, parent: techSvc.id }, merge(groups, {
            short_description: TAG + ' ' + ENVS[t].techOffering.text, owned_by: owner,
            busines_criticality: env.criticality, used_for: env.usedFor,
            service_classification: choice('service_offering', 'service_classification', ['Technology Management Service', 'Technical Service'])
        }));
        relate(techOff.id, 'Contains::Contained by', env.id);
    }

    // The kernel change of scene 3.1 names the service it affects, so the change and the alert
    // point to the same service.
    var chg = new GlideRecord('change_request');
    if (chg.get('number', 'CHG0030111')) {
        var aff = ensure('task_cmdb_ci_service', { task: chg.getUniqueValue(), cmdb_ci_service: built.PRD.id }, {});
        if (chg.getValue('business_service') === null) {
            // The change is closed: no notifications or state rules for a data correction.
            chg.setWorkflow(false);
            chg.setValue('business_service', built.PRD.id);
            chg.update();
        }
        check(true, 'CHG0030111 affects SAP S/4HANA PRD' + (aff.created ? ' (added)' : ''));
    } else {
        check(false, 'CHG0030111 not found: scene 3.1 cites it');
    }

    say('');
    say('CSDM model of SAP S/4HANA built. New relationships: ' + relCount + '.');
    say('  Business app SAP S/4HANA --Consumes--> SAP S/4HANA PRD, SAP S/4HANA QAS');
    say('  Gestión de pedidos > Pedidos de venta - España, Facturación - España --Depends on--> SAP S/4HANA PRD');
    say('  SAP Basis > SAP Basis - Producción --Contains--> SAP S/4HANA PRD');
    say('  SAP Basis > SAP Basis - No productivo --Contains--> SAP S/4HANA QAS');
    say('');
    say(problems ? problems + ' item(s) to check.' : 'Run "AIT CSDM SAP 2 - check" in two minutes, after the impact engine has read the services.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
