// B1 (Q11) script tool "Compare record counts between periods (AIT)", Global scope.
// Used by the Global workflow "Comparar periodos (AIT)": it gives exact counts for two
// periods and the groups that explain the change, which the OOB chart agent never states.
(function(inputs) {
    var ALLOWED = ['incident', 'sc_req_item', 'problem', 'change_request', 'sc_task', 'kb_knowledge'];

    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var table = str(inputs.table) || 'incident';
    var dateField = str(inputs.date_field) || 'opened_at';
    var groupBy = str(inputs.group_by) || 'priority';
    var periods = [
        { label: str(inputs.period_1_label) || 'period 1', start: str(inputs.period_1_start), end: str(inputs.period_1_end) },
        { label: str(inputs.period_2_label) || 'period 2', start: str(inputs.period_2_start), end: str(inputs.period_2_end) }
    ];

    if (ALLOWED.indexOf(table) < 0) {
        return { error: true, message: 'Table not supported: ' + table + '. Supported: ' + ALLOWED.join(', ') };
    }
    var probe = new GlideRecord(table);
    if (!probe.canRead()) {
        return { error: true, message: 'The user cannot read ' + table };
    }
    if (!probe.isValidField(dateField) || !probe.isValidField(groupBy)) {
        return { error: true, message: 'Unknown field: ' + (probe.isValidField(dateField) ? groupBy : dateField) };
    }
    var dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (var p = 0; p < periods.length; p++) {
        if (!dateRe.test(periods[p].start) || !dateRe.test(periods[p].end)) {
            return { error: true, message: 'Each period needs a start and end date as YYYY-MM-DD (end date inclusive).' };
        }
    }

    function countByGroup(period) {
        var counts = {};
        var total = 0;
        var ga = new GlideAggregate(table);
        ga.addQuery(dateField, '>=', period.start + ' 00:00:00');
        ga.addQuery(dateField, '<=', period.end + ' 23:59:59');
        ga.addAggregate('COUNT');
        ga.groupBy(groupBy);
        ga.query();
        while (ga.next()) {
            var key = str(ga.getDisplayValue(groupBy)) || '(empty)';
            var n = parseInt(str(ga.getAggregate('COUNT')), 10);
            counts[key] = n;
            total += n;
        }
        return { counts: counts, total: total };
    }

    var a = countByGroup(periods[0]);
    var b = countByGroup(periods[1]);
    var groups = {};
    var k;
    for (k in a.counts) groups[k] = true;
    for (k in b.counts) groups[k] = true;

    var rows = [];
    for (k in groups) {
        var x = a.counts[k] || 0;
        var y = b.counts[k] || 0;
        rows.push({
            group: k,
            period_1: x,
            period_2: y,
            change: y - x,
            change_pct: x ? Math.round((y - x) * 1000 / x) / 10 : null
        });
    }
    rows.sort(function(r1, r2) { return Math.abs(r2.change) - Math.abs(r1.change); });

    var totalChange = b.total - a.total;
    var share = rows.filter(function(r) { return r.change * totalChange > 0; }).map(function(r) {
        return { group: r.group, change: r.change, share_of_total_change_pct: totalChange ? Math.round(r.change * 1000 / totalChange) / 10 : null };
    });

    return {
        table: table,
        date_field: dateField,
        group_by: groupBy,
        period_1: { label: periods[0].label, start: periods[0].start, end: periods[0].end, total: a.total },
        period_2: { label: periods[1].label, start: periods[1].start, end: periods[1].end, total: b.total },
        total_change: totalChange,
        total_change_pct: a.total ? Math.round(totalChange * 1000 / a.total) / 10 : null,
        by_group: rows,
        groups_explaining_change: share
    };
})(inputs);
