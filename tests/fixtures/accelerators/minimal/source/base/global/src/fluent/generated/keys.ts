import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    x_snagentic_min_app: {
                        table: 'sys_app'
                        id: '5e1f0c2a9b8d4e7fa1c3d5e7f9a0b2c4'
                    }
                }
            }
        }
    }
}
