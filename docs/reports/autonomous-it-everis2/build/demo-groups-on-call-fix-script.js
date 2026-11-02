// Fix Script "AIT demo groups and on-call", Global scope, update set AIT-DEMO-groups.
// Gives every DEMO.PI group real people and an on-call rota, so routing, assignment, "who is on
// call" and escalation work in every scene, not only in SAP:
// - 22 fictitious Spanish users (no password, role itil, @example.com, +34 600 100 3xx), some of them in
//   two groups, as in a real service desk;
// - a manager per group (only where the group has none);
// - a "<group> 24x7" rota (Europe/Madrid, all day): Primary rotates weekly from this Monday through
//   the engineers, Secondary is the manager. A group that already has an active rota keeps it (SAP's
//   is the one scenes 2.5 and 3.2 use); the script only adds people to the group.
// Rotas are made with the on-call engine's own API (OnCallRotation, OnCallMember), as the creation
// wizard does: a plain insert of cmn_rota_member leaves the roster empty.
// Safe to run again: users, memberships and roles are found first; rotas are created only once.
// Demo data only: every user it creates has "[AIT-DEMO]" in its notes.
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
    function ensure(table, key, values) {
        var gr = new GlideRecord(table);
        for (var k in key) { gr.addQuery(k, key[k]); }
        gr.setLimit(1);
        gr.query();
        if (gr.next()) { return { id: gr.getUniqueValue(), created: false }; }
        gr.initialize();
        for (var k2 in key) { gr.setValue(k2, key[k2]); }
        for (var v in values) { gr.setValue(v, values[v]); }
        return { id: gr.insert(), created: true };
    }

    // The people. Shared members (Daniel, Sara, Carlos, Inés, Rubén) make "who else can take this" realistic.
    var PEOPLE = {
        'lucia.navarro': ['Lucía', 'Navarro', 'Responsable Identidad', '301'],
        'pablo.ortega': ['Pablo', 'Ortega', 'Soporte Identidad', '302'],
        'sara.gil': ['Sara', 'Gil', 'Soporte Identidad y M365', '303'],
        'raul.castro': ['Raúl', 'Castro', 'Responsable M365', '311'],
        'irene.molina': ['Irene', 'Molina', 'Soporte M365', '312'],
        'hugo.serrano': ['Hugo', 'Serrano', 'Soporte M365', '313'],
        'ana.delgado': ['Ana', 'Delgado', 'Responsable Redes', '321'],
        'daniel.romero': ['Daniel', 'Romero', 'Soporte Redes e Identidad', '322'],
        'javier.rubio': ['Javier', 'Rubio', 'Soporte Redes', '323'],
        'nuria.cano': ['Nuria', 'Cano', 'Soporte Redes', '324'],
        'teresa.iglesias': ['Teresa', 'Iglesias', 'Responsable Puesto de trabajo', '331'],
        'alvaro.prieto': ['Álvaro', 'Prieto', 'Soporte Puesto de trabajo', '332'],
        'carmen.vidal': ['Carmen', 'Vidal', 'Soporte Puesto de trabajo', '333'],
        'carlos.vega': ['Carlos', 'Vega', 'Soporte SAP Basis y Redes', '341'],
        'marcos.leon': ['Marcos', 'León', 'Responsable Aplicaciones', '351'],
        'ines.herrera': ['Inés', 'Herrera', 'Soporte Aplicaciones y ServiceNow', '352'],
        'oscar.medina': ['Óscar', 'Medina', 'Soporte Aplicaciones', '353'],
        'beatriz.santos': ['Beatriz', 'Santos', 'Responsable Seguridad', '361'],
        'ruben.cortes': ['Rubén', 'Cortés', 'Soporte Seguridad e Identidad', '362'],
        'laura.pena': ['Laura', 'Peña', 'Soporte Seguridad', '363'],
        'diego.fuentes': ['Diego', 'Fuentes', 'Responsable ServiceNow', '371'],
        'paula.reyes': ['Paula', 'Reyes', 'Soporte ServiceNow', '372']
    };
    // Per group: manager, then the engineers in their Primary order. Existing members stay.
    var GROUPS = [
        { name: 'DEMO.PI.Identity', manager: 'lucia.navarro', engineers: ['pablo.ortega', 'sara.gil', 'daniel.romero', 'ruben.cortes'] },
        { name: 'DEMO.PI.M365', manager: 'raul.castro', engineers: ['irene.molina', 'hugo.serrano', 'sara.gil'] },
        { name: 'DEMO.PI.Network', manager: 'ana.delgado', engineers: ['daniel.romero', 'javier.rubio', 'nuria.cano', 'carlos.vega'] },
        { name: 'DEMO.PI.Workplace', manager: 'teresa.iglesias', engineers: ['alvaro.prieto', 'carmen.vidal'] },
        { name: 'DEMO.PI.SAP', manager: '', engineers: ['carlos.vega'] },
        { name: 'DEMO.PI.Applications', manager: 'marcos.leon', engineers: ['ines.herrera', 'oscar.medina'] },
        { name: 'DEMO.PI.Security', manager: 'beatriz.santos', engineers: ['ruben.cortes', 'laura.pena'] },
        { name: 'DEMO.PI.ServiceNow', manager: 'diego.fuentes', engineers: ['paula.reyes', 'ines.herrera'] }
    ];

    var itil = byName('sys_user_role', 'name', 'itil');
    var users = {};
    var newUsers = 0;
    for (var u in PEOPLE) {
        var p = PEOPLE[u];
        var made = ensure('sys_user', { user_name: u }, {
            first_name: p[0], last_name: p[1], title: p[2], email: u + '@example.com',
            mobile_phone: '+34 600 100 ' + p[3], phone: '+34 910 100 ' + p[3],
            preferred_language: 'es', time_zone: 'Europe/Madrid', active: true,
            notification: 2, notes: TAG + ' fictitious demo user, no password'
        });
        users[u] = made.id;
        if (made.created) { newUsers++; }
        if (itil) { ensure('sys_user_has_role', { user: made.id, role: itil }, {}); }
    }
    say('Users: ' + newUsers + ' created, ' + (Object.keys(PEOPLE).length - newUsers) + ' already there.');

    // Monday of this week, local time: the weekly rotation starts there, as the SAP rota does.
    var monday = new GlideDateTime();
    monday.addDaysLocalTime(1 - monday.getDayOfWeekLocalTime());
    var mondayDate = monday.getLocalDate().getValue();
    // An all-day shift repeated every day, given the way the creation wizard gives it: the first day
    // from 00:00:00 to 23:59:59.
    var start = new GlideDateTime();
    start.setDisplayValueInternal(monday.getLocalDate().getDisplayValueInternal() + ' 00:00:00');
    var end = new GlideDateTime();
    end.setDisplayValueInternal(monday.getLocalDate().getDisplayValueInternal() + ' 23:59:59');

    function activeRota(groupId) {
        var r = new GlideRecord('cmn_rota');
        r.addQuery('group', groupId);
        r.addActiveQuery();
        r.setLimit(1);
        r.query();
        return r.next() ? r : null;
    }
    function addRoster(oc, rotaId, name, order, members) {
        oc.setIsAllDayRoster(true);
        var ids = oc.createRosters(rotaId, 1, 1, start, new GlideDuration(15 * 60 * 1000), 'weekly', 1, NaN, name, order);
        var rosterId = ids && ids.length ? ids[0] + '' : '';
        if (!rosterId) { return 0; }
        var added = 0;
        for (var i = 0; i < members.length; i++) {
            var m = new OnCallMember();
            m.setRosterId(rosterId);
            m.setMemberId(members[i]);
            m.setOrder(i + 1);
            m.setFrom(mondayDate);
            if (m.create()) { added++; }
        }
        return added;
    }
    function onCallNow(groupId) {
        var res = new OnCallRotation().whoIsOnCall(groupId, '', '', new GlideDateTime()) || [];
        var list = [];
        for (var i = 0; i < res.length; i++) { list.push(res[i]); }
        list.sort(function(a, b) { return a.order - b.order; });
        var names = [];
        var gu = new GlideRecord('sys_user');
        for (var j = 0; j < list.length; j++) { if (gu.get(list[j].userId)) { names.push(gu.getDisplayValue()); } }
        return names;
    }

    for (var g = 0; g < GROUPS.length; g++) {
        var def = GROUPS[g];
        var group = new GlideRecord('sys_user_group');
        if (!group.get('name', def.name)) { check(false, def.name + ' not found'); continue; }
        var groupId = group.getUniqueValue();
        if (def.manager && !group.getValue('manager')) {
            group.setValue('manager', users[def.manager]);
            group.update();
        }
        var people = def.engineers.concat(def.manager ? [def.manager] : []);
        var joined = 0;
        for (var k = 0; k < people.length; k++) {
            if (ensure('sys_user_grmember', { group: groupId, user: users[people[k]] }, {}).created) { joined++; }
        }
        var members = new GlideAggregate('sys_user_grmember');
        members.addQuery('group', groupId);
        members.addAggregate('COUNT');
        members.query();
        var total = members.next() ? members.getAggregate('COUNT') : '0';
        var managerName = group.manager.getDisplayValue() || '(none)';

        var rota = activeRota(groupId);
        var rotaNote;
        if (rota) {
            rotaNote = 'keeps its rota "' + rota.getValue('name') + '"';
        } else {
            var oc = new OnCallRotation();
            var rotaId = oc.createNewRota(def.name + ' 24x7', groupId, 'Europe/Madrid', start, end, 'weekly', true,
                def.name + ' 24x7 (Madrid)', false, undefined, undefined, undefined, '1234567', false);
            if (!rotaId) {
                check(false, def.name + ': the on-call engine refused the rota (needs the rota_admin or admin role)');
                continue;
            }
            var primary = addRoster(oc, rotaId, 'Primary', 1, def.engineers.map(function(n) { return users[n]; }));
            var secondary = group.getValue('manager') ? addRoster(oc, rotaId, 'Secondary', 2, [group.getValue('manager')]) : 0;
            rotaNote = 'new rota "' + def.name + ' 24x7": Primary ' + primary + ' members (weekly from ' + mondayDate + '), Secondary ' + secondary;
        }
        var now = onCallNow(groupId);
        check(now.length > 0, def.name + ': ' + total + ' members (+' + joined + '), manager ' + managerName + ', ' + rotaNote +
            '; on call now: ' + (now.length ? now.join(', then ') : 'nobody'));
    }

    say('');
    say(problems ? problems + ' item(s) to check.' : 'Every DEMO.PI group has people and someone on call.');
    var text = log.join('\n');
    gs.info(text);
    gs.print(text);
})();
