import { Record } from '@servicenow/sdk/core'

// The minimal test pack's scoped application (spec 005, M7). Created in global; safe to deactivate.
Record({
    $id: Now.ID['x_snagentic_min_app'],
    table: 'sys_app',
    data: {
        name: 'snagentic test pack (minimal)',
        scope: 'x_snagentic_min',
        short_description: 'The minimal accelerator test pack (spec 005, M7). Safe to deactivate.',
        version: '1.0.0',
    },
})
