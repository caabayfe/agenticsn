import { CrossScopePrivilege } from '@servicenow/sdk/core'

// A2 cross-scope-privilege: read and write on incident, declared in source.
CrossScopePrivilege({
    $id: Now.ID['a2_priv_read_incident'],
    status: 'allowed',
    operation: 'read',
    targetName: 'incident',
    targetScope: 'global',
    targetType: 'sys_db_object',
})

CrossScopePrivilege({
    $id: Now.ID['a2_priv_write_incident'],
    status: 'allowed',
    operation: 'write',
    targetName: 'incident',
    targetScope: 'global',
    targetType: 'sys_db_object',
})
