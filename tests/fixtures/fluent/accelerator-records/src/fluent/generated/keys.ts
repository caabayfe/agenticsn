import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_acl_incident_read: {
                        table: 'sys_security_acl'
                        id: '15275190e0ab4e5bb00ccae516e73d7e'
                    }
                    a2_property: {
                        table: 'sys_properties'
                        id: 'd81aa60e28424892bee568d50e2ea7d9'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '2eefab9bb9b84072a679151ddabd9cbb'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'f53218248bd24a5fabf3fde2c100e616'
                    }
                }
                composite: [
                    {
                        table: 'sys_security_acl_role'
                        id: 'e9d8c1c241fe434e81ca8665025e2cc8'
                        key: {
                            sys_security_acl: '15275190e0ab4e5bb00ccae516e73d7e'
                            sys_user_role: {
                                id: 'b96ac931ed474d6697a68609d7fcb04a'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                ]
            }
        }
    }
}
