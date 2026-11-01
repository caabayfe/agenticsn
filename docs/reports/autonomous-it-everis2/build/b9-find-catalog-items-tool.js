// B9 (Q10) script tool "Find catalog items for an incident (AIT)", Global scope.
// Used by the Global workflow "Incidencia que es una solicitud (AIT)". The OOB answer sees that an
// incident is really a request but names no catalog item; this tool returns the incident's facts and
// the active catalog items its caller can order that match the agent's keywords. Read only; runs as
// the user, so GlideRecordSecure applies their ACLs.
(function(inputs) {
    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var number = str(inputs.incident_number);
    var inc = new GlideRecordSecure('incident');
    if (!number || (!inc.get('number', number) && !inc.get(number))) {
        return { error: true, message: 'Incident not found or not readable: ' + number };
    }
    var caller = str(inc.getValue('caller_id'));

    // Keywords come from the agent (for example "monitor, pantalla"): the catalog is in English and
    // the incident in Spanish, so the agent passes words in both languages.
    var words = str(inputs.keywords).split(/[,;]/);
    var items = [];
    var seen = {};
    for (var w = 0; w < words.length && items.length < 5; w++) {
        var word = words[w].replace(/^\s+|\s+$/g, '');
        if (word.length < 3) continue;
        var item = new GlideRecordSecure('sc_cat_item');
        item.addActiveQuery();
        item.addQuery('123TEXTQUERY321', word);
        item.setLimit(10);
        item.query();
        while (item.next() && items.length < 5) {
            var id = item.getUniqueValue();
            if (seen[id]) continue;
            seen[id] = true;
            var visible = true;
            try {
                visible = new sn_sc.CatItem(id).canView(false, caller);
            } catch (e) {
                visible = true;
            }
            if (!visible) continue;
            items.push({
                sys_id: id,
                name: str(item.getDisplayValue('name')),
                category: str(item.getDisplayValue('category')),
                short_description: str(item.getValue('short_description')),
                price: str(item.getDisplayValue('price'))
            });
        }
    }

    return {
        incident: str(inc.getValue('number')),
        short_description: str(inc.getValue('short_description')),
        description: str(inc.getValue('description')),
        caller: str(inc.getDisplayValue('caller_id')),
        current_group: str(inc.getDisplayValue('assignment_group')) || '(none)',
        state: str(inc.getDisplayValue('state')),
        catalog_items: items,
        message: items.length ? '' : 'No active catalog item the caller can order matches these keywords.'
    };
})(inputs);
