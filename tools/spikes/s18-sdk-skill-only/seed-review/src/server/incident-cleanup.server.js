var IncidentCleanup = Class.create();
IncidentCleanup.prototype = {
  run: function () {
    var gr = new GlideRecord('incident');
    gr.addQuery('active', true);
    gr.query();
    while (gr.next()) {
      var caller = new GlideRecord('sys_user');
      caller.get(gr.caller_id);
      gr.assignment_group = '8a5055c9c61122780043563ef53438e3';
      gr.setWorkflow(false);
      gr.update();
    }
  },
  type: 'IncidentCleanup'
};
