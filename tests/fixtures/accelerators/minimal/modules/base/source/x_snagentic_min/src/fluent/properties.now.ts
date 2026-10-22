import { Record } from '@servicenow/sdk/core'

// Switches the minimal test pack on (spec 005, M7).
Record({
    $id: Now.ID['x_snagentic_min_enabled'],
    table: 'sys_properties',
    data: {
        name: 'x_snagentic_min.enabled',
        type: 'boolean',
        value: 'true',
        description: 'Switches the minimal test pack on (spec 005, M7).',
    },
})
