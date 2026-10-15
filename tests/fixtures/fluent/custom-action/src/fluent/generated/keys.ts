import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_action: {
                        table: 'sys_hub_action_type_definition'
                        id: '49c3e5e95dfd44adb3b7973e26521d04'
                    }
                    a2_action_call: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'f564a16528154c14b0bfad282e86c06b'
                    }
                    a2_action_caller: {
                        table: 'sys_hub_flow'
                        id: '9b4e4ffdb9d44671b9888d1743f07830'
                    }
                    a2_action_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: '0be671a2638f4493bcb48bc2555b1365'
                    }
                    a2_action_script: {
                        table: 'sys_hub_step_instance'
                        id: '3bdaabcac980423e89aa8bfc4d297670'
                    }
                    a2_action_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'bdc92006f7e6443b90a389629e064536'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: 'd211a63ffa28446fa0852f81f5176f41'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: 'c30cf211f4014c6a900d4ae87144a17b'
                    }
                }
                composite: [
                    {
                        table: 'sys_hub_action_output'
                        id: '0df3a0b03d624f33b7809d155eb70e05'
                        key: {
                            model: '49c3e5e95dfd44adb3b7973e26521d04'
                            element: '__action_status__'
                        }
                    },
                    {
                        table: 'sys_hub_action_output'
                        id: '0f10481c6e094f5daa560677ebd1dd80'
                        key: {
                            model: '49c3e5e95dfd44adb3b7973e26521d04'
                            element: 'verdict'
                        }
                    },
                    {
                        table: 'sys_hub_action_input'
                        id: '14d21108a22244d0b72711cceb2aa459'
                        key: {
                            model: '49c3e5e95dfd44adb3b7973e26521d04'
                            element: 'threshold'
                        }
                    },
                    {
                        table: 'sys_hub_step_ext_output'
                        id: '392ce5a47fe34f35a6cdab2f52408c27'
                        key: {
                            model: '3bdaabcac980423e89aa8bfc4d297670'
                            element: 'score'
                        }
                    },
                    {
                        table: 'sys_element_mapping'
                        id: '3a676fc266634be7a579e3efe1147a5f'
                        key: {
                            id: '3bdaabcac980423e89aa8bfc4d297670'
                            table: 'var__m_sys_hub_step_ext_input_3bdaabcac980423e89aa8bfc4d297670'
                            field: 'threshold'
                        }
                    },
                    {
                        table: 'sys_hub_step_ext_output'
                        id: '6af32291029e45259f31046290b230af'
                        key: {
                            model: '3bdaabcac980423e89aa8bfc4d297670'
                            element: 'verdict'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '78352b7622854260bd9ca99547c99219'
                        key: {
                            name: 'var__m_sys_hub_action_output_49c3e5e95dfd44adb3b7973e26521d04'
                            element: 'verdict'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_element_mapping'
                        id: '8040105c2c5e41f7b9a1d5d9e8b060f9'
                        key: {
                            id: '49c3e5e95dfd44adb3b7973e26521d04'
                            table: 'var__m_sys_hub_action_output_49c3e5e95dfd44adb3b7973e26521d04'
                            field: 'verdict'
                        }
                    },
                    {
                        table: 'sys_variable_value'
                        id: '8be483a69e5141babb505c288133b3f2'
                        key: {
                            document_key: '3bdaabcac980423e89aa8bfc4d297670'
                            variable: '71aa7f6647032200b4fad7527c9a719b'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '90ae09bfe8b34611b68ab73ebbf397a3'
                        key: {
                            name: 'var__m_sys_hub_action_output_49c3e5e95dfd44adb3b7973e26521d04'
                            element: '__action_status__'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'ac2ec99ebfbd4a4f8177b6f40d1f92f9'
                        key: {
                            name: 'var__m_sys_hub_action_output_49c3e5e95dfd44adb3b7973e26521d04'
                            element: '__dont_treat_as_error__'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_action_output'
                        id: 'b00ae0003e114cfd90131ce335a69c96'
                        key: {
                            model: '49c3e5e95dfd44adb3b7973e26521d04'
                            element: '__dont_treat_as_error__'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'b04ae215a8f04be79695c86731478e1c'
                        key: {
                            name: 'var__m_sys_hub_action_input_49c3e5e95dfd44adb3b7973e26521d04'
                            element: 'threshold'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_variable_value'
                        id: 'eac9e8e942354e84bb3d79c2dee1d4f8'
                        key: {
                            document_key: '3bdaabcac980423e89aa8bfc4d297670'
                            variable: '74315b04b3201300176b051a16a8dc2b'
                        }
                    },
                    {
                        table: 'sys_hub_step_ext_input'
                        id: 'fb4e12eb1076406fac645f5cd19da6e0'
                        key: {
                            model: '3bdaabcac980423e89aa8bfc4d297670'
                            element: 'threshold'
                        }
                    },
                ]
            }
        }
    }
}
