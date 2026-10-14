import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_priv_read_incident: {
                        table: 'sys_scope_privilege'
                        id: '55613f6f54fa4e1f9b009b82e1e6e6d3'
                    }
                    a2_priv_write_incident: {
                        table: 'sys_scope_privilege'
                        id: '34115bcce15147539701606c039ce2c0'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: 'c812339c71f6469e95713bdafa904f86'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '6a78f491f3df401d95c67fb99c771e02'
                    }
                }
            }
        }
    }
}
