// Fix Script "AIT demo 1 - prepare (day before)", Global scope, update set AIT-P2-demo-prep.
// Run it the day before the demo (System Definition > Fix Scripts > Run Fix Script). It is safe to run
// again: each run retires the copies of the previous run and makes new ones.
// It refreshes the records that a demo uses up, resets the ones a scene changes, and prints the demo
// route: every record to open, in the order of the storyline, with a check of its state.
// Demo data only: every record it creates is tagged [AIT-DEMO], [AIT-P1] or [AIT-PIR], on DEMO.PI groups
// or the SAP demo CIs; the major incidents of scene 3.5 also keep a Madrid location, changes and problems.
// It changes no configuration; it realigns the start date of the demo SAP on-call rota.
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
    var wrapUp = copyIncident('INC0025491', function(inc) {
        inc.assignment_group = group.identity;
        inc.assigned_to = persona;
        inc.state = 2;
    });
    // The Spanish note the wrap-up turns into close notes. Written as the persona, so the activity
    // stream shows the analyst as its author, not the account that runs this script.
    if (wrapUp) {
        var note = firstWorkNote(incident('INC0025491'));
        var imp = new GlideImpersonate();
        var me = imp.impersonate(persona);
        var asPersona = new GlideRecord('incident');
        if (asPersona.get(wrapUp.getUniqueValue())) {
            asPersona.work_notes = note;
            asPersona.update();
        }
        imp.impersonate(me);
    }
    // Scene 2.1: a monitor request filed as an incident in the wrong group. A fresh copy each run,
    // because the scene may convert it into a request.
    var wrongDoor = copyIncident('INC0025308', function(inc, src) {
        inc.assignment_group = src.getValue('assignment_group');
    });

    // 3. Reset the on-call incident of scene 3.2: unassigned and New in DEMO.PI.SAP.
    var onCall = incident('INC0025716');
    if (onCall) {
        onCall.assignment_group = group.sap;
        onCall.assigned_to = '';
        onCall.state = 1;
        onCall.update();
    }

    // 3b. On-call rota of scenes 2.5 and 3.2: Marta Ruiz is first in a 2-week rotation, so starting it on
    // the Monday of this week keeps her on call for at least the next 7 days, whatever day the demo is.
    var monday = new GlideDateTime();
    monday.addDaysLocalTime(1 - monday.getDayOfWeekLocalTime());
    var rosters = new GlideRecord('cmn_rota_roster');
    rosters.addQuery('rota.group', group.sap);
    rosters.addActiveQuery();
    rosters.query();
    while (rosters.next()) {
        rosters.rotation_interval_count = 2;
        rosters.setValue('rotation_start_date', monday.getLocalDate().getValue());
        rosters.update();
    }
    function onCallNow() {
        var res = new OnCallRotation().whoIsOnCall(group.sap, '', '', new GlideDateTime()) || [];
        var list = [];
        for (var i = 0; i < res.length; i++) { list.push(res[i]); }
        list.sort(function(a, b) { return a.order - b.order; });
        var u = new GlideRecord('sys_user');
        return list.length && u.get(list[0].userId) ? u.getDisplayValue() : '(nobody)';
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

    // 7. Major incidents for scene 3.5: fresh copies, In Progress, assigned to the persona, with the cause and
    // the resolution already written. Resolving one live starts the trigger "AIT post incident review on
    // resolved (DEMO.PI)", and the review drafts itself from these records. The review is only as good as the
    // records it reads, so each one gets what the agent looks for: service, offering, CI and location; child
    // incidents from users; a work-note timeline; the change that caused it and the problem; an outage. The open
    // copies of the last run are cancelled, not resolved: resolving them would start the review trigger.
    function majorIncidentsForReviews() {
        var TAG = '[AIT-PIR]';
        var made = [];
        function ago(minutes) {
            var t = new GlideDateTime();
            t.addSeconds(-minutes * 60);
            return t;
        }
        // The clock time a timeline line shows, in the instance's time zone.
        function clock(minutes) {
            var t = ago(minutes);
            return t.getDisplayValue().substring(11, 16);
        }
        // Demo records are inserted without business rules, so a change or a problem can be written
        // directly in its final state without approvals, flows or state-model checks.
        function ensure(table, shortDescription, values) {
            var gr = new GlideRecord(table);
            var found = gr.get('short_description', shortDescription);
            if (!found) { gr.initialize(); gr.short_description = shortDescription; }
            for (var k in values) { if (values[k] !== undefined) { gr.setValue(k, values[k]); } }
            gr.setWorkflow(false);
            var id = found ? gr.update() : gr.insert();
            return { id: id, number: gr.getValue('number'), created: !found };
        }

        var serviceDesk = byName('sys_user_group', 'name', 'Service Desk');

        // The office the incidents happen in. There is no Spanish location on everis2, so the script keeps one.
        var madrid = byName('cmn_location', 'name', 'Madrid - Oficina comercial');
        if (!madrid) {
            var loc = new GlideRecord('cmn_location');
            loc.initialize();
            loc.name = 'Madrid - Oficina comercial';
            loc.city = 'Madrid';
            loc.country = 'Spain';
            loc.street = 'Paseo de la Castellana 95';
            madrid = loc.insert();
        }
        if (!madrid) { check(false, '3.5 location Madrid - Oficina comercial could not be created'); }

        var scenarios = [
            {
                key: 'SAP pricing',
                title: 'SAP: no se pueden grabar pedidos de venta en VA01 (error de precios V1 801)',
                description: 'Desde las {start} los usuarios de la oficina comercial de Madrid no pueden grabar pedidos de venta en ' +
                    'VA01: al grabar aparece el mensaje V1 801 "Error en la determinación de precios". Unos 25 usuarios afectados; ' +
                    'la facturación del día está bloqueada.',
                group: 'DEMO.PI.SAP', service: ['cmdb_ci_service_discovered', 'SAP S/4HANA PRD'], offering: 'Pedidos de venta - España',
                ci: 'SAP AppSRV01', impact: 1, urgency: 1, start: 150,
                cause: { existing: 'CHG0030111' },
                problem: 'La condición de precio PR00 se pierde al importar transportes junto con una actualización del kernel',
                problemText: 'El transporte de condiciones de precios importado con el cambio del kernel 7.89 PL 200 dejó la condición ' +
                    'PR00 sin registro para la organización de ventas de Madrid. Falta una validación de condiciones tras los transportes.',
                close: 'Causa raíz: el transporte de condiciones de precios importado con el cambio CHG0030111 (kernel SAP 7.89 PL 200) ' +
                    'dejó la condición PR00 sin registro para la oficina comercial de Madrid, lo que provocaba el error V1 801 al grabar ' +
                    'pedidos en VA01. Se reimportó el transporte corregido, se regeneraron los registros de condición y se validó la ' +
                    'grabación de pedidos y la facturación con usuarios de ventas. Servicio restablecido.',
                children: [
                    { user: 'abel.tuter', minutes: 145, summary: 'No puedo grabar pedidos en SAP: error V1 801',
                      text: 'Al grabar el pedido en VA01 sale "Error en la determinación de precios" (V1 801). Tengo tres clientes esperando.' },
                    { user: 'adela.cervantsz', minutes: 141, summary: 'Error de precios al crear pedidos de venta',
                      text: 'Ningún pedido nuevo se puede grabar desde las 7:30, siempre el mismo error de precios.' },
                    { user: 'aileen.mottern', minutes: 132, summary: 'No se generan facturas de los pedidos de hoy',
                      text: 'La facturación del día está parada porque no hay pedidos grabados desde primera hora.' }
                ],
                timeline: [
                    [148, 'Detección: primeras llamadas al Service Desk desde la oficina comercial de Madrid; VA01 devuelve V1 801 al grabar.'],
                    [140, 'Declarada incidencia grave: 25 usuarios sin poder grabar pedidos, facturación del día bloqueada. Puente abierto con SAP Basis y el equipo de ventas.'],
                    [125, 'Análisis: la determinación de precios no encuentra la condición PR00 para la organización de ventas de Madrid. Otras oficinas no afectadas.'],
                    [110, 'Relación con el cambio CHG0030111 (kernel 7.89 PL 200), implantado anoche junto con un transporte de condiciones de precios.'],
                    [95, 'Solución temporal descartada: introducir precios manuales en cada pedido no es viable para 25 usuarios.'],
                    [70, 'Causa encontrada: el transporte dejó PR00 sin registro de condición. Se prepara el transporte corregido.'],
                    [45, 'Transporte corregido importado en PRD y registros de condición regenerados.'],
                    [25, 'Validación: tres usuarios de ventas graban pedidos y se genera la facturación pendiente. Servicio restablecido.']
                ],
                outage: { type: 'outage', begin: 150, end: 25 }
            },
            {
                key: 'HANA database',
                title: 'SAP S/4HANA PRD no disponible: base de datos HANA bloqueada por volumen de log lleno',
                description: 'Desde las {start} SAP S/4HANA producción no responde: las transacciones se quedan esperando a la base de ' +
                    'datos y Fiori devuelve errores 503. El volumen de log de HANA (HDB) está al 100 % porque los backups de log fallan.',
                group: 'DEMO.PI.SAP', service: ['cmdb_ci_service_discovered', 'SAP S/4HANA PRD'], offering: 'Facturación - España',
                ci: 'SAP HANADB01', impact: 1, urgency: 1, start: 190,
                cause: {
                    change: 'Nueva regla de firewall en la red de base de datos de SAP (segmentación de la red de backup)',
                    changeText: 'Segmentación de la red de backup: nueva regla de firewall entre la red de base de datos de SAP y el ' +
                        'servidor de backup 10.20.40.15. Sin impacto previsto.',
                    group: 'DEMO.PI.Network', start: 1500, end: 1440
                },
                problem: 'Los backups de log de HANA fallan sin alerta cuando una regla de red bloquea el servidor de backup',
                problemText: 'La regla de firewall bloqueó el puerto 4000 del servidor de backup; los backups de log fallaron durante ' +
                    'horas sin avisar a nadie hasta que el volumen de log se llenó y la base de datos se detuvo.',
                close: 'Causa raíz: la regla de firewall del cambio de segmentación de la red de backup bloqueó el puerto 4000 entre ' +
                    'SAP HANADB01 y el servidor de backup 10.20.40.15. Los backups de log fallaron durante horas, el volumen ' +
                    '/hana/log/HDB se llenó y HANA detuvo las escrituras. Se revirtió la regla, se lanzaron los backups de log ' +
                    'pendientes, se liberó el volumen y se comprobaron pedidos y facturación. Servicio restablecido.',
                children: [
                    { user: 'adela.cervantsz', minutes: 185, summary: 'SAP no responde al facturar',
                      text: 'Cada pantalla tarda más de un minuto y la factura no se genera.' },
                    { user: 'alejandra.prenatt', minutes: 182, summary: 'Fiori da error 503 en Gestionar pedidos',
                      text: 'La aplicación Gestionar pedidos de venta devuelve "Service unavailable".' },
                    { user: 'alene.rabeck', minutes: 176, summary: 'No puedo entrar en SAP desde esta mañana',
                      text: 'El inicio de sesión se queda cargando y al final da un error de tiempo de espera.' }
                ],
                timeline: [
                    [188, 'Detección: alertas de Event Management en SAP HANADB01 (volumen de log al 97 %, backups de log fallidos) y en los servidores de aplicación.'],
                    [180, 'Declarada incidencia grave: SAP S/4HANA PRD no disponible para toda la empresa. Puente abierto con SAP Basis, bases de datos y redes.'],
                    [165, 'Análisis: el volumen /hana/log/HDB está al 100 %; HANA no puede escribir y los procesos de actualización esperan.'],
                    [150, 'Los backups de log fallan desde ayer: "backint: connection timed out to backup server 10.20.40.15:4000".'],
                    [130, 'Relación con el cambio de la regla de firewall en la red de base de datos, implantado ayer por la tarde.'],
                    [110, 'Decisión: revertir la regla de firewall en lugar de ampliar el volumen de log.'],
                    [90, 'Regla revertida; los backups de log pendientes se completan y el volumen baja al 35 %.'],
                    [60, 'HANA vuelve a aceptar escrituras; se procesan las actualizaciones pendientes.'],
                    [35, 'Validación: inicio de sesión, pedidos, facturación y Fiori correctos. Servicio restablecido.']
                ],
                outage: { type: 'outage', begin: 190, end: 35 }
            },
            {
                key: 'MFA',
                title: 'MFA: los usuarios no reciben la notificación de Microsoft Authenticator al iniciar sesión',
                description: 'Desde las {start} muchos usuarios no pueden iniciar sesión en Microsoft 365 ni en las aplicaciones con ' +
                    'inicio de sesión único: la notificación de Microsoft Authenticator no llega o pide un número que no aparece.',
                group: 'DEMO.PI.Identity', service: ['cmdb_ci_service', 'Microsoft 365'], offering: '',
                ci: '', impact: 1, urgency: 2, start: 120,
                cause: {
                    change: 'Política de acceso condicional: exigir coincidencia de número en Microsoft Authenticator para todos los usuarios',
                    changeText: 'Activar la coincidencia de número en las notificaciones de Microsoft Authenticator para todos los ' +
                        'usuarios mediante una política de acceso condicional.',
                    group: 'DEMO.PI.Identity', start: 180, end: 170
                },
                problem: 'Las versiones antiguas de Microsoft Authenticator no muestran la coincidencia de número',
                problemText: 'Unos 300 móviles tienen una versión de Authenticator anterior a la que muestra la coincidencia de ' +
                    'número; la política se aplicó a todos sin comprobar las versiones instaladas.',
                close: 'Causa raíz: la política de acceso condicional que exige la coincidencia de número en Microsoft Authenticator ' +
                    'se aplicó a todos los usuarios, pero unos 300 móviles tenían una versión antigua de la aplicación que no muestra ' +
                    'el número, así que no podían completar el inicio de sesión. Se excluyó temporalmente a esos usuarios de la ' +
                    'política, se publicó la actualización de Authenticator por MDM y se comprobó el acceso con usuarios afectados. ' +
                    'Servicio restablecido.',
                children: [
                    { user: 'abel.tuter', minutes: 115, summary: 'No me llega la notificación de Authenticator',
                      text: 'Intento entrar en Outlook y el móvil no recibe nada; no puedo trabajar.' },
                    { user: 'alejandra.prenatt', minutes: 110, summary: 'Authenticator pide un número que no veo',
                      text: 'La pantalla de inicio de sesión me pide escribir un número en la aplicación, pero la aplicación no muestra ninguno.' },
                    { user: 'aileen.mottern', minutes: 104, summary: 'Bloqueada fuera de Teams y del correo',
                      text: 'Desde las 9 no puedo entrar ni en Teams ni en el correo, siempre se queda esperando la aprobación.' }
                ],
                timeline: [
                    [118, 'Detección: pico de llamadas al Service Desk por inicios de sesión que no se completan.'],
                    [112, 'Declarada incidencia grave: cientos de usuarios sin acceso a Microsoft 365. Puente abierto con Identidad y Puesto de trabajo.'],
                    [100, 'Análisis: los registros de inicio de sesión muestran fallos de MFA solo en usuarios con versiones antiguas de Authenticator.'],
                    [85, 'Relación con el cambio de la política de acceso condicional (coincidencia de número), activado esta mañana para todos.'],
                    [70, 'Solución temporal: grupo de exclusión para los usuarios con versiones antiguas.'],
                    [45, 'Actualización de Authenticator publicada por MDM a los móviles afectados.'],
                    [20, 'Validación: usuarios afectados inician sesión con normalidad. Servicio restablecido.']
                ],
                outage: { type: 'degradation', begin: 120, end: 20 }
            }
        ];

        // The persona works the major incidents, and an incident can only be assigned to a member of its group.
        function ensureMember(groupId) {
            var m = new GlideRecord('sys_user_grmember');
            m.addQuery('group', groupId);
            m.addQuery('user', persona);
            m.query();
            if (m.hasNext()) { return true; }
            m.initialize();
            m.group = groupId;
            m.user = persona;
            return !!m.insert();
        }

        // 1. Cancel the open copies of the last run, and their children. Cancelled, not resolved: resolving
        // would start the review trigger on them. Their outages go too, so the CIs don't collect them.
        var old = new GlideRecord('incident');
        old.addQuery('state', 'IN', '1,2,3');
        old.addQuery('short_description', 'STARTSWITH', TAG);
        old.query();
        var cancelled = 0;
        while (old.next()) {
            old.state = 8;
            old.incident_state = 8;
            old.close_notes = 'Copia de demo cancelada por una nueva preparación.';
            old.setWorkflow(false);
            old.update();
            cancelled++;
        }
        // A business rule renames every outage to "<CI> Outage", so old ones are found through their incident.
        var oldOutage = new GlideRecord('cmdb_ci_outage');
        oldOutage.addQuery('task_number.short_description', 'STARTSWITH', TAG);
        oldOutage.query();
        while (oldOutage.next()) { oldOutage.deleteRecord(); }

        // 2. One fresh major incident per scenario.
        for (var s = 0; s < scenarios.length; s++) {
            var sc = scenarios[s];
            var group = byName('sys_user_group', 'name', sc.group);
            var service = byName(sc.service[0], 'name', sc.service[1]);
            var offering = sc.offering ? byName('service_offering', 'name', sc.offering) : '';
            var ci = sc.ci ? byName('cmdb_ci', 'name', sc.ci) : '';
            check(!!group, sc.key + ': group ' + sc.group);
            check(!!service, sc.key + ': service ' + sc.service[1]);
            if (sc.offering) { check(!!offering, sc.key + ': offering ' + sc.offering); }
            if (sc.ci) { check(!!ci, sc.key + ': CI ' + sc.ci); }
            check(!!group && ensureMember(group), sc.key + ': the persona is a member of ' + sc.group);

            var change = '';
            if (sc.cause.existing) {
                change = byName('change_request', 'number', sc.cause.existing);
                check(!!change, sc.key + ': change ' + sc.cause.existing);
            } else {
                var chg = ensure('change_request', TAG + ' ' + sc.cause.change, {
                    description: sc.cause.changeText, type: 'normal', state: '3', assignment_group: byName('sys_user_group', 'name', sc.cause.group),
                    business_service: service, cmdb_ci: ci, start_date: ago(sc.cause.start), end_date: ago(sc.cause.end),
                    work_start: ago(sc.cause.start), work_end: ago(sc.cause.end), close_code: 'successful', close_notes: 'Implantado según lo previsto.'
                });
                change = chg.id;
                check(!!change, sc.key + ': change ' + chg.number + (chg.created ? ' created' : ' reused'));
            }
            var prb = ensure('problem', TAG + ' ' + sc.problem, {
                description: sc.problemText, state: '103', assignment_group: group, assigned_to: persona, business_service: service,
                cmdb_ci: ci, impact: '1', urgency: '2'
            });
            check(!!prb.id, sc.key + ': problem ' + prb.number + (prb.created ? ' created' : ' reused'));

            var reporter = byName('sys_user', 'user_name', sc.children[0].user);
            var mi = new GlideRecord('incident');
            mi.initialize();
            mi.short_description = TAG + ' ' + sc.title;
            mi.description = sc.description.replace('{start}', clock(sc.start));
            mi.caller_id = reporter;
            mi.contact_type = 'phone';
            mi.category = 'software';
            mi.impact = sc.impact;
            mi.urgency = sc.urgency;
            mi.assignment_group = group;
            mi.assigned_to = persona;
            mi.business_service = service;
            if (offering) { mi.service_offering = offering; }
            if (ci) { mi.cmdb_ci = ci; }
            mi.location = madrid;
            mi.caused_by = change;
            mi.problem_id = prb.id;
            mi.opened_at = ago(sc.start);
            mi.major_incident_state = 'accepted';
            mi.promoted_by = persona;
            mi.promoted_on = ago(sc.start - 10);
            mi.state = 2;
            // Written now, so the presenter only clicks Resolve: the trigger needs Resolved with an assignee.
            mi.close_code = 'Resolved by change';
            mi.close_notes = sc.close;
            var miId = mi.insert();
            if (miId) { made.push(mi.getValue('number') + ' (' + sc.key + ')'); }
            if (!miId) { continue; }

            for (var t = 0; t < sc.timeline.length; t++) {
                mi.work_notes = '[' + clock(sc.timeline[t][0]) + '] ' + sc.timeline[t][1];
                mi.update();
            }
            // The "Major incident assignment" rule gives an accepted major incident to whoever saves it when
            // that user is in the group, so the persona and the promotion are set again without rules.
            var owner = new GlideRecord('incident');
            if (owner.get(miId)) {
                owner.assigned_to = persona;
                owner.promoted_by = persona;
                owner.promoted_on = ago(sc.start - 10);
                owner.setWorkflow(false);
                owner.update();
            }

            // Children go to the Service Desk, outside the DEMO.PI groups, so the SLA pilot leaves them alone.
            var kids = [];
            for (var c = 0; c < sc.children.length; c++) {
                var k = sc.children[c];
                var kid = new GlideRecord('incident');
                kid.initialize();
                kid.short_description = TAG + ' ' + k.summary;
                kid.description = k.text;
                kid.caller_id = byName('sys_user', 'user_name', k.user);
                kid.contact_type = 'self-service';
                kid.parent_incident = miId;
                kid.business_service = service;
                if (offering) { kid.service_offering = offering; }
                kid.location = madrid;
                kid.assignment_group = serviceDesk;
                kid.impact = 2;
                kid.urgency = 2;
                kid.opened_at = ago(k.minutes);
                if (kid.insert()) { kids.push(kid.getValue('number')); }
            }
            check(kids.length == sc.children.length, sc.key + ': child incidents ' + kids.join(', '));

            if (ci || service) {
                var out = new GlideRecord('cmdb_ci_outage');
                out.initialize();
                out.cmdb_ci = ci || service;
                out.type = sc.outage.type;
                out.begin = ago(sc.outage.begin);
                out.end = ago(sc.outage.end);
                out.task_number = miId;
                check(!!out.insert(), sc.key + ': ' + sc.outage.type + ' recorded on ' + (sc.ci || sc.service[1]));
            }
        }
        return { made: made, cancelled: cancelled };
    }
    var reviews = majorIncidentsForReviews();

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
    // propose a duplicate. Its ACL refuses a plain delete, even for admin: ask the Alert Automation
    // agent on a SAP alert to delete it (its own "Delete Alerts Grouping Automation" tool).
    var automations = new GlideRecord('sn_em_tbac_alert_clustering_definitions');
    var automationCount = 0;
    var automationIds = [];
    if (automations.isValid()) {
        automations.addQuery('name', 'CONTAINS', 'SAP PRD');
        automations.query();
        automationCount = automations.getRowCount();
        while (automations.next()) { automationIds.push(automations.getUniqueValue()); }
    }

    say('AIT demo prepared. Retired ' + retired + ' old copies, closed ' + closedAlerts + ' old demo alerts.');
    say('');
    say('Act 1, the employee (Employee Center chat, as Analista AIT (ES))');
    check(kbOk, '1.1 KB0010019 VPN article is published');
    check(r67Ok && r68Ok, '1.2 Visio: RITM0010067 open and RITM0010068 waiting for approval');
    var vpn = incident('INC0025715');
    // Compare the value, not the label: the labels follow the session language.
    check(!!vpn && vpn.getValue('state') == '3', '1.3 INC0025715 VPN is on hold (needs her answer)');
    say('        1.3 the persona has ' + mineCount + ' open incidents and requests (expected 4: INC0025715, INC0025716, RITM0010067, RITM0010068)');
    say('');
    say('Act 2, the service desk (SOW, Otto panel, as Analista AIT (ES))');
    check(!!wrongDoor, '2.1 ' + num(wrongDoor) + ' second monitor (a request in disguise): ask with the number in the question');
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
    var who = onCallNow();
    check(who.indexOf('Marta Ruiz') == 0, '2.5 and 3.2 on call now in DEMO.PI.SAP: ' + who + ' (rotation from ' + monday.getLocalDate().getDisplayValue() + ', 2 weeks)');
    check(state('INC0025194') != 'missing', '3.3 INC0025194 runbook PDF: ' + state('INC0025194'));
    check(automationCount == 0, '3.4 grouping automations named "SAP PRD": ' + automationCount + ' (on a SAP alert, ask Otto: Delete the alert grouping automation with sys_id ' + automationIds.join(', ') + ')');
    check(reviews.made.length == 3, '3.5 major incidents for the review, In Progress, assigned to the persona: ' + reviews.made.join('; ') + '. Resolve one, reload after 20 s, open the alert; "No" in rehearsals (cancelled ' + reviews.cancelled + ' old copies)');
    say('');
    say('Act 4, management: analytics chat (persona) and AI Agent Analytics (admin). Nothing to prepare.');
    say('');
    say(problems ? problems + ' item(s) to check before the demo.' : 'Everything is ready.');

    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
