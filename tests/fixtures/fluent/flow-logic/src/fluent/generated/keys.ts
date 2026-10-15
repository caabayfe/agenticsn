import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_logic_each: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '6b30882573a0465c9705f7aab22f4e45'
                    }
                    a2_logic_else: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'd00a673ed0ed45a28a6e7ad311ccaca7'
                    }
                    a2_logic_elseif_p2: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '1b773263ca514daaba4a25886ac459af'
                    }
                    a2_logic_exit: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'd7d4cf1b0a0841ff821899cb15e67cb0'
                    }
                    a2_logic_exit_if: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'c5bd75648c344e209f16b93c71bfad7a'
                    }
                    a2_logic_flow: {
                        table: 'sys_hub_flow'
                        id: 'cc7ae669085a493e861a67790860045c'
                    }
                    a2_logic_if_p1: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '0b9a7aaa61244296b9f77d7f46e1f0a5'
                    }
                    a2_logic_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: '7becccf144404c4083cf31161ccc0a63'
                    }
                    a2_logic_note_each: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'aab2bd45549a476588b68413c3f5661f'
                    }
                    a2_logic_note_p1: {
                        table: 'sys_hub_action_instance_v2'
                        id: '418d6e17f5ec4b4792617f2e55c00a6b'
                    }
                    a2_logic_note_p2: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'f81247f956e44e16a72faad9c1f62c1c'
                    }
                    a2_logic_skip: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '6c78a68efa39498cbc3e00c9a5c0567d'
                    }
                    a2_logic_skip_if: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'bb923ee55c6f43f1a70a15089006ee8d'
                    }
                    a2_logic_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '743e9e97f2814ec68054436ff3c76b0f'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '682bc30657b74352a5f420f332e61b58'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '6c972a7b5f23404b8d1bc1fd732ac28f'
                    }
                }
            }
        }
    }
}
