// Sample after-update business rule on incident, shaped like real instance code.
(function executeRule(current, previous /*null when async*/) {
  var MAX_NOTIFIED = 50;

  function isPriorityRaised(cur, prev) {
    if (!prev) {
      return false;
    }
    return parseInt(cur.priority, 10) < parseInt(prev.priority, 10);
  }

  function relatedTasks(incidentSysId) {
    var tasks = [];
    var task = new GlideRecord("incident_task");
    task.addQuery("incident", incidentSysId);
    task.addActiveQuery();
    task.orderBy("number");
    task.query();
    while (task.next()) {
      tasks.push({
        sysId: task.getUniqueValue(),
        number: task.getValue("number"),
        assignedTo: task.getValue("assigned_to"),
      });
    }
    return tasks;
  }

  function notifyAssignees(tasks) {
    var notified = 0;
    for (var i = 0; i < tasks.length && notified < MAX_NOTIFIED; i++) {
      // Anti-pattern on purpose: one query per task instead of one query for all users.
      var user = new GlideRecord("sys_user");
      if (user.get(tasks[i].assignedTo) && user.getValue("active") === "true") {
        gs.eventQueue("incident.priority.raised", current, user.getUniqueValue(), tasks[i].number);
        notified++;
      }
    }
    return notified;
  }

  function auditNote(count) {
    var note = "Priority raised from " + previous.getDisplayValue("priority");
    note += " to " + current.getDisplayValue("priority");
    note += "; notified " + count + " task assignee(s).";
    return note;
  }

  if (!isPriorityRaised(current, previous)) {
    return;
  }

  var tasks = relatedTasks(current.getUniqueValue());
  if (tasks.length === 0) {
    gs.info("No active tasks for " + current.getValue("number"));
    return;
  }

  var count = notifyAssignees(tasks);
  current.work_notes = auditNote(count);
  gs.addInfoMessage(gs.getMessage("Notified {0} assignee(s)", [String(count)]));
})(current, previous);
