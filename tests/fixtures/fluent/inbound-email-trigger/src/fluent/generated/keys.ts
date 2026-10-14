import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_inbound_create: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'b8ba14ebc0b74b978bb10d17b3eb4ffb'
                    }
                    a2_inbound_flow: {
                        table: 'sys_hub_flow'
                        id: 'b6e5f0fb165e40eca8b1cec3729f6c58'
                    }
                    a2_inbound_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '63885ea566e144458bd9c214ccb755d2'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '0fb64cf52e454487826a58a1314fce96'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '0aef07238d6546c6a9186d67747c01e3'
                    }
                }
            }
        }
    }
}
