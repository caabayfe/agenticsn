import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_daily_flow: {
                        table: 'sys_hub_flow'
                        id: '55f7280380cd4b22b85763ba3e2c4a93'
                    }
                    a2_daily_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'ee919d96e8724ad58ac2761ff8e47a4a'
                    }
                    a2_daily_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '0821abb01d9c4a23bb2df4d1ee431dbc'
                    }
                    a2_repeat_flow: {
                        table: 'sys_hub_flow'
                        id: 'e44be024d5f9412cbb1a07741f5d82a4'
                    }
                    a2_repeat_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: '5807c9c0100b46859de3298ca3f15ff7'
                    }
                    a2_repeat_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'eea29eef2f204d13ab43342135c76f71'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '720a8b437e174e9a9e516b69e35d2763'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '3564a76556e744f7aa10a9fe54aeff02'
                    }
                }
            }
        }
    }
}
