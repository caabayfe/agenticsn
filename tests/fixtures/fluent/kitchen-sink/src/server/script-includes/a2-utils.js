var A2Utils = Class.create()
A2Utils.prototype = {
    initialize: function () {},
    label: function (priority) {
        return priority === '1' ? 'critical' : 'normal'
    },
    type: 'A2Utils',
}
