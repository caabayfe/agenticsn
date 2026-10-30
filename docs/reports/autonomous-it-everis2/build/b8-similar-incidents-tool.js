// B8 (Q03) script tool "Get similar resolved incidents (AIT)", Global scope.
// Used by the Global workflow "Plan con incidencias similares (AIT)". It reuses the
// OOB resolution-plan data fetch (public script include), then adds what the OOB plan
// leaves out: which group resolved each similar incident, when, and how often, so the
// plan can cite evidence and suggest the right group.
(function(inputs) {
    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var number = str(inputs.incident_number);
    var inc = new GlideRecordSecure('incident');
    if (!number || (!inc.get('number', number) && !inc.get(number))) {
        return { error: true, message: 'Incident not found or not readable: ' + number };
    }
    number = str(inc.getValue('number'));

    var data = new sn_itsm_aia.InvestigatingAndResolvingIncidentsUtil().fetchAllData(number) || {};
    var found = data['similar resolved incident results'] || [];
    // Semantic scores cluster high (0.88-0.95 on this data), so the cut-off only drops
    // noise; the agent decides which hits are really the same problem.
    var MIN_SCORE = 0.85;

    var similar = [];
    var groups = {};
    for (var i = 0; i < found.length; i++) {
        var hit = found[i];
        var num = str(hit.columns && hit.columns.number);
        if (!num || num == number || hit.score < MIN_SCORE) continue;
        var s = new GlideRecordSecure('incident');
        if (!s.get('number', num)) continue;
        var group = str(s.getDisplayValue('assignment_group')) || '(none)';
        groups[group] = (groups[group] || 0) + 1;
        similar.push({
            number: num,
            short_description: str(s.getValue('short_description')),
            resolved_by_group: group,
            resolved_at: str(s.getDisplayValue('resolved_at')).substring(0, 10),
            close_notes: str(s.getValue('close_notes')).substring(0, 700),
            similarity: Math.round(hit.score * 100) / 100
        });
    }

    var ranking = [];
    for (var g in groups) ranking.push({ group: g, incidents: groups[g] });
    ranking.sort(function(a, b) { return b.incidents - a.incidents; });

    var currentGroup = str(inc.getDisplayValue('assignment_group'));
    return {
        incident: number,
        short_description: str(inc.getValue('short_description')),
        current_group: currentGroup || '(none)',
        similar_resolved_count: similar.length,
        similar_resolved: similar,
        groups_that_resolved_similar: ranking,
        suggested_group: ranking.length ? ranking[0].group : '',
        group_matches: ranking.length ? ranking[0].group == currentGroup : null
    };
})(inputs);
