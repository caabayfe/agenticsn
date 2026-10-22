import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    x_snagentic_min_enabled: {
                        table: 'sys_properties'
                        id: '6f2a1d3b0c9e4f8ab2d4e6f8a0b1c3d5'
                    }
                }
            }
        }
    }
}
