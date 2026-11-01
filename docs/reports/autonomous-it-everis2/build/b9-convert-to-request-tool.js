// B9 (Q10) script tool "Convert an incident into a request (AIT)", Global scope, supervised
// execution: the user confirms before anything changes (autonomy level 2). It orders the catalog
// item for the incident's caller, links the request to the incident, tells the caller, and resolves
// the incident with a note that names the request. Runs as the user: GlideRecordSecure applies their
// ACLs, so an agent who cannot update the incident is refused.
(function(inputs) {
    function str(v) { return (v === null || v === undefined) ? '' : '' + v; }

    var number = str(inputs.incident_number);
    var inc = new GlideRecordSecure('incident');
    if (!number || (!inc.get('number', number) && !inc.get(number))) {
        return { error: true, message: 'Incident not found or not readable: ' + number };
    }
    number = str(inc.getValue('number'));
    if (!inc.canWrite()) {
        return { error: true, message: 'You cannot update ' + number + '.' };
    }
    if (['1', '2', '3'].indexOf(str(inc.getValue('state'))) < 0) {
        return { error: true, message: number + ' is not open (state ' + str(inc.getDisplayValue('state')) + '); nothing was changed.' };
    }
    var caller = str(inc.getValue('caller_id'));
    if (!caller) {
        return { error: true, message: number + ' has no caller to order the item for.' };
    }
    var item = new GlideRecordSecure('sc_cat_item');
    if (!item.get(str(inputs.catalog_item_sys_id)) || !item.active) {
        return { error: true, message: 'Catalog item not found or not active: ' + str(inputs.catalog_item_sys_id) };
    }
    var itemName = str(item.getDisplayValue('name'));

    var order = new sn_sc.CartJS().orderNow({
        sysparm_id: item.getUniqueValue(),
        sysparm_quantity: '1',
        sysparm_requested_for: caller,
        variables: {}
    });
    var requestId = str(order && order.request_id);
    var requestNumber = str(order && order.request_number);
    if (!requestId) {
        return { error: true, message: 'The order was not placed; ' + number + ' was not changed.' };
    }
    var req = new GlideRecord('sc_request');
    if (req.get(requestId)) {
        req.parent = inc.getUniqueValue();
        req.update();
    }

    var why = 'No era una incidencia sino una petición de "' + itemName + '". Se ha registrado la solicitud ' +
        requestNumber + ' y se cierra esta incidencia.';
    inc.comments = 'Hemos convertido tu incidencia en la solicitud ' + requestNumber + ' (' + itemName +
        '). Puedes seguirla en el portal.';
    inc.work_notes = why;
    inc.close_code = 'Solution provided';
    inc.close_notes = why;
    inc.state = 6;
    if (!inc.update()) {
        return { error: true, message: 'Request ' + requestNumber + ' was created, but ' + number + ' could not be resolved.', request: requestNumber };
    }
    return {
        incident: number,
        incident_state: str(inc.getDisplayValue('state')),
        request: requestNumber,
        catalog_item: itemName,
        requested_for: str(inc.getDisplayValue('caller_id'))
    };
})(inputs);
