// B4 (Q06) script tool "Propose alert response rule (AIT)", Global scope.
// Used in supervised mode by the Global workflow "Proponer respuesta a alertas (AIT)".
// From one alert it writes an INACTIVE alert management rule that creates an incident
// for the same pattern (metric on the same CI, or on the same CI class), linked to the
// OOB "Create Incident" subflow, and says how often the pattern fired in 30 days. A
// person reviews and activates it; the tool never activates anything.
(function(inputs) {
    var CREATE_INCIDENT_SUBFLOW = '45454f6193330300415c74aff67ffbfb';
    var REPLAY_DAYS = 30;

    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var number = str(inputs.alert_number);
    var alert = new GlideRecordSecure('em_alert');
    if (!number || (!alert.get('number', number) && !alert.get(number))) {
        return { error: true, message: 'Alert not found or not readable: ' + number };
    }
    number = str(alert.getValue('number'));
    var metric = str(alert.getValue('metric_name'));
    var ciId = str(alert.getValue('cmdb_ci'));
    if (!metric || !ciId) {
        return { error: true, message: number + ' has no metric name or no CI, so there is no pattern to match.' };
    }
    var ciName = str(alert.getDisplayValue('cmdb_ci'));
    var ciClass = str(alert.cmdb_ci.sys_class_name);
    var byClass = str(inputs.match) == 'class';

    var pattern = 'metric_name=' + metric + (byClass ? '^cmdb_ci.sys_class_name=' + ciClass : '^cmdb_ci=' + ciId);
    var filter = pattern + '^maintenance=false^incidentISEMPTY';
    var inWords = 'alerts with metric "' + metric + '" on ' + (byClass ? 'any CI of class ' + ciClass : ciName) +
        ', not in maintenance and without an incident';

    // Replay: how often this pattern fired, so the reviewer sees the expected volume.
    var since = new GlideDateTime();
    since.addDaysUTC(-REPLAY_DAYS);
    var past = new GlideRecord('em_alert');
    past.addEncodedQuery(pattern);
    past.addQuery('sys_created_on', '>=', since);
    past.orderByDesc('sys_created_on');
    past.query();
    var count = 0;
    var examples = [];
    while (past.next()) {
        count++;
        if (examples.length < 5) {
            examples.push(str(past.getValue('number')) + ' (' + str(past.getDisplayValue('sys_created_on')).substring(0, 16) +
                ', ' + str(past.getDisplayValue('severity')) + ', incident: ' + (str(past.getDisplayValue('incident')) || 'none') + ')');
        }
    }
    var replay = { days: REPLAY_DAYS, matching_alerts: count, examples: examples };

    var same = new GlideRecord('em_alert_management_rule');
    same.addQuery('alert_filter', filter);
    same.query();
    if (same.next()) {
        return {
            already_exists: true,
            rule: str(same.getValue('name')),
            active: str(same.getValue('active')),
            link: '/em_alert_management_rule.do?sys_id=' + same.getUniqueValue(),
            matches: inWords,
            replay: replay
        };
    }

    var rule = new GlideRecordSecure('em_alert_management_rule');
    if (!rule.canCreate()) {
        return {
            error: true,
            message: 'You cannot create alert management rules (Event Management admin role needed).',
            matches: inWords,
            replay: replay
        };
    }
    rule.initialize();
    rule.setValue('name', 'AIT propuesta: incidencia para ' + metric + ' en ' + (byClass ? ciClass : ciName));
    rule.setValue('description', 'Proposed from ' + number + ' by the AIT alert response workflow. Matches ' + inWords +
        '. Replay: ' + count + ' matching alerts in the last ' + REPLAY_DAYS + ' days. Inactive until a person reviews it.');
    rule.setValue('active', false);
    rule.setValue('alert_filter', filter);
    rule.setValue('type', 'incident');
    rule.setValue('automatic_execution_setting', '1');
    rule.setValue('multiple_alert_rules', '1');
    rule.setValue('order', 300);
    if (alert.getValue('assignment_group')) rule.setValue('assignment_group', alert.getValue('assignment_group'));
    var ruleId = rule.insert();
    if (!ruleId) {
        return { error: true, message: 'The rule was refused.' };
    }

    var action = new GlideRecord('em_alert_man_m2m_rule_flow');
    action.initialize();
    action.setValue('management_rule', ruleId);
    action.setValue('sub_flow', CREATE_INCIDENT_SUBFLOW);
    action.setValue('execution', '3'); // 3 = automatic and manual, as the OOB rule
    action.setValue('executions_limit', 1);
    action.setValue('active', true);
    action.insert();

    return {
        created: true,
        rule: str(rule.getValue('name')),
        active: 'false',
        link: '/em_alert_management_rule.do?sys_id=' + ruleId,
        matches: inWords,
        action: 'create an incident with the OOB "Create Incident" subflow, assigned to ' +
            (str(alert.getDisplayValue('assignment_group')) || 'the alert group'),
        replay: replay,
        next_step: 'Review the filter and the replay, test on one alert, then activate the rule.'
    };
})(inputs);
