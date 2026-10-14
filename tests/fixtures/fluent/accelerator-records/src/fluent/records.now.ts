import { Acl, Property } from '@servicenow/sdk/core'

// A2 accelerator-records: a system property and an ACL, as an accelerator would ship them.
Property({
    $id: Now.ID['a2_property'],
    name: 'x_2222332_s11.a2.enabled',
    type: 'boolean',
    value: true,
    description: 'snagentic test A2 property',
    roles: { read: ['admin'], write: ['admin'] },
})

Acl({
    $id: Now.ID['a2_acl_incident_read'],
    type: 'record',
    table: 'incident',
    operation: 'read',
    roles: ['itil'],
    description: 'snagentic test A2 ACL',
})
