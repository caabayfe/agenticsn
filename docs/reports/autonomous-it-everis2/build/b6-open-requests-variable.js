// B6 (Q08) default value of the catalog variable "ait_abiertas" ("Solicitudes de Visio
// abiertas") on the Visio Pro for Office 365 item, Global. Single line text, order 50,
// read only. The conversational catalog shows it in the summary before the user submits,
// so a duplicate request is visible. A tool on the OOB Catalog Agent was tried first and
// never called: that agent follows fixed steps.
javascript:(function(){var r=new GlideRecord('sc_req_item');r.addActiveQuery();r.addQuery('requested_for',gs.getUserID());r.addQuery('cat_item','a678656e4fc3c2c0960f95bd0210c7e5');r.orderByDesc('opened_at');r.query();var a=[];while(r.next()){a.push(r.getValue('number')+' ('+(r.getValue('approval')=='requested'?'pendiente de aprobación':r.getDisplayValue('stage'))+')');}return a.length?a.join('; '):'Ninguna';})()
