import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: '38d6a3c6a1454f1c95f7b86b5fe1236a'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '8a1ef4fba1414849828f38c1290262e1'
                    }
                    s11_b_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '4116525f94fc4943bfefe9067a04465d'
                    }
                    s11_b_update: {
                        table: 'sys_hub_action_instance_v2'
                        id: '11dc3fe3d56541f3a9aefcc9c11269b7'
                    }
                    s11_flow: {
                        table: 'sys_hub_flow'
                        id: '8a924849cd84412081573bb363ec4326'
                    }
                    s11_flow_b: {
                        table: 'sys_hub_flow'
                        id: '09772b5f71224ddca105736535f9b1ec'
                    }
                    s11_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'f9381d9198a9460882d172d3bb7b188c'
                    }
                    s11_update: {
                        table: 'sys_hub_action_instance_v2'
                        id: '799d072dfdad466cb87e374254335599'
                    }
                }
            }
        }
    }
}
