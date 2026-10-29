// B7 business rule "Alert to incident: carry AI insight (AIT)", Global scope.
// Table em_alert, after insert and update, condition: incident changes and is not empty.
// When an alert (or an alert group) gets an incident, the incident receives what the
// operator saw on the alert: the AI summary, the CI and its owner, recent changes on the
// CI by number, and the related alerts. It fills CI and group only when they are empty.
(function executeRule(current, previous) {
    var MAX_NOTE = 6000;

    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    function plain(html) {
        return str(html)
            .replace(/\[\/?code\]/g, '')
            .replace(/<br\s*\/?>|<\/li>|<\/p>/gi, '\n')
            .replace(/<li>/gi, '- ')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // The latest AI note of one kind ("Summarization", "investigation", "analysis").
    function aiNote(alertId, kind) {
        var j = new GlideRecord('sys_journal_field');
        j.addQuery('name', 'em_alert');
        j.addQuery('element_id', alertId);
        j.addQuery('element', 'work_notes');
        j.addQuery('value', 'CONTAINS', kind);
        j.orderByDesc('sys_created_on');
        j.setLimit(1);
        j.query();
        return j.next() ? plain(j.getValue('value')) : '';
    }

    // A group alert has no AI notes of its own: use its most severe member. A member alert
    // shows the rest of its group, because the group's CI often holds the cause.
    var groupId = str(current.getValue('parent')) || current.getUniqueValue();
    var isGroup = groupId == current.getUniqueValue();
    var parent = null;
    if (!isGroup) {
        parent = new GlideRecord('em_alert');
        if (!parent.get(groupId)) parent = null;
    }
    var related = [];
    var source = current;
    var m = new GlideRecord('em_alert');
    m.addQuery('parent', groupId);
    m.addQuery('sys_id', '!=', current.getUniqueValue());
    m.orderBy('severity');
    m.query();
    while (m.next()) {
        related.push(str(m.getValue('number')) + ' (' + str(m.getDisplayValue('severity')) + ', ' +
            str(m.getDisplayValue('cmdb_ci')) + '): ' + str(m.getValue('description')).substring(0, 160));
        if (isGroup && source === current) {
            source = new GlideRecord('em_alert');
            source.get(m.getUniqueValue());
        }
    }

    var insight = aiNote(source.getUniqueValue(), 'Summarization') ||
        aiNote(source.getUniqueValue(), 'investigation') ||
        aiNote(source.getUniqueValue(), 'analysis');

    var ciId = str(current.getValue('cmdb_ci'));
    var ciIds = ciId ? [ciId] : [];
    if (parent && parent.getValue('cmdb_ci') && str(parent.getValue('cmdb_ci')) != ciId) {
        ciIds.push(str(parent.getValue('cmdb_ci')));
    }
    var ciLine = '';
    if (ciId) {
        var ci = new GlideRecord('cmdb_ci');
        if (ci.get(ciId)) {
            ciLine = str(ci.getDisplayValue()) + ' (grupo de soporte: ' + (str(ci.getDisplayValue('support_group')) || 'sin grupo') +
                ', responsable: ' + (str(ci.getDisplayValue('owned_by')) || str(ci.getDisplayValue('managed_by')) || 'sin responsable') + ')';
        }
    }
    var changes = [];
    if (ciIds.length) {
        var since = new GlideDateTime();
        since.addSeconds(-48 * 3600);
        var chg = new GlideRecord('change_request');
        chg.addQuery('cmdb_ci', 'IN', ciIds.join(','));
        chg.addQuery('sys_updated_on', '>=', since);
        chg.orderByDesc('sys_updated_on');
        chg.setLimit(3);
        chg.query();
        while (chg.next()) {
            changes.push(str(chg.getValue('number')) + ' en ' + str(chg.getDisplayValue('cmdb_ci')) + ': ' +
                str(chg.getValue('short_description')) + ' (estado: ' + str(chg.getDisplayValue('state')) +
                ', fin: ' + (str(chg.getDisplayValue('end_date')) || '-') + ')');
        }
    }

    var origin = '[AIT] Incidencia creada desde la alerta ' + str(current.getValue('number'));
    if (isGroup && related.length) origin += ' (grupo de ' + related.length + ' alertas)';
    if (parent) origin += ' (parte del grupo ' + str(parent.getValue('number')) + ')';
    var lines = [origin + '.'];
    if (ciLine) lines.push('CI: ' + ciLine + '.');
    lines.push(changes.length ? 'Cambios recientes (48 h) en los CI de la alerta y su grupo: ' + changes.join('; ') + '.' :
        'Sin cambios en los CI de la alerta ni de su grupo en las últimas 48 h.');
    if (related.length) {
        lines.push((isGroup || !parent ? 'Alertas del grupo' : 'Otras alertas del grupo ' + str(parent.getValue('number'))) +
            ':\n- ' + related.join('\n- '));
    }
    if (insight) lines.push('Análisis de IA de la alerta ' + str(source.getValue('number')) + ':\n' + insight);

    var inc = new GlideRecord('incident');
    if (!inc.get(current.getValue('incident'))) return;
    // Creating the incident updates the alert more than once; write the hand-off note once.
    var seen = new GlideRecord('sys_journal_field');
    seen.addQuery('name', 'incident');
    seen.addQuery('element_id', inc.getUniqueValue());
    seen.addQuery('value', 'STARTSWITH', '[AIT] Incidencia creada desde la alerta');
    seen.setLimit(1);
    seen.query();
    if (seen.hasNext()) return;
    if (!inc.getValue('cmdb_ci') && ciId) inc.setValue('cmdb_ci', ciId);
    if (!inc.getValue('assignment_group') && current.getValue('assignment_group')) {
        inc.setValue('assignment_group', current.getValue('assignment_group'));
    }
    inc.work_notes = lines.join('\n\n').substring(0, MAX_NOTE);
    inc.update();
})(current, previous);
