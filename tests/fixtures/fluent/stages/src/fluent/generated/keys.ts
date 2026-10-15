import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_stages_closure: {
                        table: 'sys_hub_action_instance_v2'
                        id: '2981000d724b410fac54c3a47caf7980'
                    }
                    a2_stages_flow: {
                        table: 'sys_hub_flow'
                        id: '0bc75aaa30664d7dbf22144b79f9f0f4'
                    }
                    a2_stages_triage: {
                        table: 'sys_hub_action_instance_v2'
                        id: '07b64086348e4ca482b19bfab4978f6e'
                    }
                    a2_stages_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'c9256cd267fc4a89a276744267d211ea'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: 'd352299bb0d44c05b255684a4bdc0e7a'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'a83a14d72c0e4f168c5cc18605216030'
                    }
                }
                composite: [
                    {
                        table: 'sys_hub_flow_stage'
                        id: 'd9e70dd7996c4b71a3cd6936e72aa2cb'
                        key: {
                            flow: '0bc75aaa30664d7dbf22144b79f9f0f4'
                            value: 'closure'
                        }
                    },
                    {
                        table: 'sys_hub_flow_stage'
                        id: 'e0edd3be7e204107a4ee7bd01a773a85'
                        key: {
                            flow: '0bc75aaa30664d7dbf22144b79f9f0f4'
                            value: 'triage'
                        }
                    },
                ]
            }
        }
    }
}
