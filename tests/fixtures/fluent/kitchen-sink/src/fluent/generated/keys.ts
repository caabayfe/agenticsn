import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_acl_incident_read: {
                        table: 'sys_security_acl'
                        id: 'a5bd6dd510a147d2928b99b786c76392'
                    }
                    a2_action: {
                        table: 'sys_hub_action_type_definition'
                        id: 'ad51a18ef8234860adcc24dfc962b590'
                    }
                    a2_action_call: {
                        table: 'sys_hub_action_instance_v2'
                        id: '00513ec8f8814fe39779b59e3abe614d'
                    }
                    a2_action_caller: {
                        table: 'sys_hub_flow'
                        id: '31d7a6c6d2ff41bc93475c4cb6529bdf'
                    }
                    a2_action_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'b6dc1b132ae14ba9949a23b124e7b842'
                    }
                    a2_action_script: {
                        table: 'sys_hub_step_instance'
                        id: 'a9f1b78c01554a4cb2793eeb559c56b8'
                    }
                    a2_action_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'bd18078fcb284d27a1d214fe90c4f561'
                    }
                    a2_business_rule: {
                        table: 'sys_script'
                        id: '3baa52ca1d3f49479fbc8ffdd7e9e51b'
                    }
                    a2_daily_flow: {
                        table: 'sys_hub_flow'
                        id: 'e90b7ddee36e429d87afcba9526ce130'
                    }
                    a2_daily_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'c676bfb51c1d415c8ba71d6b894049c3'
                    }
                    a2_daily_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'e81087e18f6549fc99ede522efbe1b3e'
                    }
                    a2_inbound_create: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'a4bdab35a1714dc197834e21d2b9ec2a'
                    }
                    a2_inbound_flow: {
                        table: 'sys_hub_flow'
                        id: '8679a02b7c114d1b95e0defe8ed5cdbe'
                    }
                    a2_inbound_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'eab99d811709490988f71ccfaf36ea50'
                    }
                    a2_logic_each: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'bc50bc2daafe4a4eacf4d170df4f64ee'
                    }
                    a2_logic_else: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '3c88ff5ccbce45729a7a80f31c779d79'
                    }
                    a2_logic_elseif_p2: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '438e445283324f549090a090661076b9'
                    }
                    a2_logic_exit: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'd4853a3666b84f1e80cd888acca3123e'
                    }
                    a2_logic_exit_if: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'b69ef498c6ba4cc5bceaebc9886e6ec3'
                    }
                    a2_logic_flow: {
                        table: 'sys_hub_flow'
                        id: '0d0aab63245944b59b1e25c0b2aeba4a'
                    }
                    a2_logic_if_p1: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '116e20079072431095fddfafd0ffe6fc'
                    }
                    a2_logic_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: '7dcacb6ac51e47f0afa320cf6db6afe3'
                    }
                    a2_logic_note_each: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'db53daa1080d40c887cf95f40bde1d0f'
                    }
                    a2_logic_note_p1: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'ece87f7223484f63b5079f6c1a6d205c'
                    }
                    a2_logic_note_p2: {
                        table: 'sys_hub_action_instance_v2'
                        id: '14478318be464640a94263b612a96626'
                    }
                    a2_logic_skip: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '562d565807f548cd8480811d3c8a08ea'
                    }
                    a2_logic_skip_if: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'bb9db311ae044f57af826e4b8f9e349a'
                    }
                    a2_logic_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'dc572860060b4dc9af8f56c4e0e54fc5'
                    }
                    a2_priv_read_incident: {
                        table: 'sys_scope_privilege'
                        id: '36233182ae834ec1a1ca24f76bb3f374'
                    }
                    a2_priv_write_incident: {
                        table: 'sys_scope_privilege'
                        id: 'a854282ad6a1434085c4dacb18d0a188'
                    }
                    a2_property: {
                        table: 'sys_properties'
                        id: '6e92783945264f5f8246d908fccc4afe'
                    }
                    a2_repeat_flow: {
                        table: 'sys_hub_flow'
                        id: 'fe6a5031905e4ce08dcbdb4dd0da919c'
                    }
                    a2_repeat_lookup: {
                        table: 'sys_hub_action_instance_v2'
                        id: '38d2be0df3204a30aa4e9d29b14acb28'
                    }
                    a2_repeat_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '1a6359909ae24c7ea64c85653d24046a'
                    }
                    a2_script_include: {
                        table: 'sys_script_include'
                        id: '2e3e40974f304477b26b72eb4691f40c'
                    }
                    a2_stages_closure: {
                        table: 'sys_hub_action_instance_v2'
                        id: '0bf64b20728a47e5a3b87752ba060112'
                    }
                    a2_stages_flow: {
                        table: 'sys_hub_flow'
                        id: 'a7364380819f46f8aa5a80539f865ab9'
                    }
                    a2_stages_triage: {
                        table: 'sys_hub_action_instance_v2'
                        id: '440c49351ec9481f9b39471ce3a5564c'
                    }
                    a2_stages_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: 'c130800e800343e6a9b9a8e128082ffb'
                    }
                    a2_subflow: {
                        table: 'sys_hub_flow'
                        id: '36310466663c44eaaf626a257c82c464'
                    }
                    a2_subflow_call: {
                        table: 'sys_hub_sub_flow_instance_v2'
                        id: '0926b59feeda43bd816e3043477f576c'
                    }
                    a2_subflow_caller: {
                        table: 'sys_hub_flow'
                        id: '7231b8d463aa489ca35ed0c616314eea'
                    }
                    a2_subflow_check: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'fac971f814864fd5890edac39b215f6f'
                    }
                    a2_subflow_end: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '5a31a2d53dbf44118643ca7a24bbf07b'
                    }
                    a2_subflow_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'd1e0b05f02734cf683165d4fde97e3e5'
                    }
                    a2_subflow_out: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '79acc68ffbf7431d9f377df1dbd32856'
                    }
                    a2_subflow_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '753f46717cfa4deba7ff9396ebcd0999'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '947f1c5132084ca18a348cc9dc0d5ae0'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '736642c62dc1447082aedc26eeaf4bfa'
                    }
                    'src_server_a2-note_ts': {
                        table: 'sys_module'
                        id: 'dfa748358182472495aec2c8fec4e065'
                    }
                    'src_server_script-includes_a2-utils_js': {
                        table: 'sys_module'
                        id: 'b1a5c2781c79456ea13728bf0786ea49'
                    }
                }
                composite: [
                    {
                        table: 'sys_element_mapping'
                        id: '09037f2e9fe84480aac3fc632a38b472'
                        key: {
                            id: 'a9f1b78c01554a4cb2793eeb559c56b8'
                            table: 'var__m_sys_hub_step_ext_input_a9f1b78c01554a4cb2793eeb559c56b8'
                            field: 'threshold'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '1c8333f262104d53b7e5a2dbd3b3e1c6'
                        key: {
                            name: 'var__m_sys_hub_flow_input_36310466663c44eaaf626a257c82c464'
                            element: 'note'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_stage'
                        id: '1e7844d3138e48a8b6413f67c719abf1'
                        key: {
                            flow: 'a7364380819f46f8aa5a80539f865ab9'
                            value: 'triage'
                        }
                    },
                    {
                        table: 'sys_hub_action_output'
                        id: '21f71c7e593140e88d56ee2e37bbccda'
                        key: {
                            model: 'ad51a18ef8234860adcc24dfc962b590'
                            element: '__dont_treat_as_error__'
                        }
                    },
                    {
                        table: 'sys_variable_value'
                        id: '22599de803344afaa226b1f14b3ba92e'
                        key: {
                            document_key: 'a9f1b78c01554a4cb2793eeb559c56b8'
                            variable: '74315b04b3201300176b051a16a8dc2b'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '272c752f72fc44e3b1f253e8a3c40a08'
                        key: {
                            name: 'var__m_sys_hub_flow_output_36310466663c44eaaf626a257c82c464'
                            element: 'done'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '5443eee868dc4ec48239a391210e7274'
                        key: {
                            name: 'var__m_sys_hub_action_output_ad51a18ef8234860adcc24dfc962b590'
                            element: '__action_status__'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '5cf0679805b3467abecffc5cd08fac77'
                        key: {
                            name: 'var__m_sys_hub_flow_input_36310466663c44eaaf626a257c82c464'
                            element: 'incident'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '608d4b673999487ca44a5a5c1829ce08'
                        key: {
                            sys_security_acl: 'a5bd6dd510a147d2928b99b786c76392'
                            sys_user_role: {
                                id: '89f7497cb0ec470080ff5449218f80f4'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                    {
                        table: 'sys_hub_step_ext_output'
                        id: '792cc6bbc4bd44c291e0bcd8820e4702'
                        key: {
                            model: 'a9f1b78c01554a4cb2793eeb559c56b8'
                            element: 'score'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: '8451e588d9544970ae35dde18053f128'
                        key: {
                            model: '36310466663c44eaaf626a257c82c464'
                            element: 'note'
                        }
                    },
                    {
                        table: 'sys_variable_value'
                        id: '8a7ce6256eca4e80b941e480d65e55e9'
                        key: {
                            document_key: 'a9f1b78c01554a4cb2793eeb559c56b8'
                            variable: '71aa7f6647032200b4fad7527c9a719b'
                        }
                    },
                    {
                        table: 'sys_hub_flow_stage'
                        id: '9fc39b163fb041f69db2a5dc99955e06'
                        key: {
                            flow: 'a7364380819f46f8aa5a80539f865ab9'
                            value: 'closure'
                        }
                    },
                    {
                        table: 'sys_element_mapping'
                        id: 'aec254d914454864aa521b5bd40df408'
                        key: {
                            id: 'ad51a18ef8234860adcc24dfc962b590'
                            table: 'var__m_sys_hub_action_output_ad51a18ef8234860adcc24dfc962b590'
                            field: 'verdict'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'c9b990f215dd41da89e457a8dc88a249'
                        key: {
                            name: 'var__m_sys_hub_action_output_ad51a18ef8234860adcc24dfc962b590'
                            element: '__dont_treat_as_error__'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_action_output'
                        id: 'cab04236c95e4f61bf9327013cb796b5'
                        key: {
                            model: 'ad51a18ef8234860adcc24dfc962b590'
                            element: 'verdict'
                        }
                    },
                    {
                        table: 'sys_hub_action_input'
                        id: 'cb8d47dd0d23476b95361a317801a68e'
                        key: {
                            model: 'ad51a18ef8234860adcc24dfc962b590'
                            element: 'threshold'
                        }
                    },
                    {
                        table: 'sys_hub_action_output'
                        id: 'd34f364c7e2145b09fa1517e781c7bc6'
                        key: {
                            model: 'ad51a18ef8234860adcc24dfc962b590'
                            element: '__action_status__'
                        }
                    },
                    {
                        table: 'sys_hub_step_ext_input'
                        id: 'd831853e714c4dfcab2d60a67d597e79'
                        key: {
                            model: 'a9f1b78c01554a4cb2793eeb559c56b8'
                            element: 'threshold'
                        }
                    },
                    {
                        table: 'sys_hub_step_ext_output'
                        id: 'd8c8e41aa61e458c864d176ef6fe3bfd'
                        key: {
                            model: 'a9f1b78c01554a4cb2793eeb559c56b8'
                            element: 'verdict'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'e33e53a855b84b01bd431a5baaf2a849'
                        key: {
                            model: '36310466663c44eaaf626a257c82c464'
                            element: 'incident'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e578ab76a72d41d9978c83a61f54b349'
                        key: {
                            name: 'var__m_sys_hub_action_output_ad51a18ef8234860adcc24dfc962b590'
                            element: 'verdict'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: 'e8aee1955d464d31b69fd9f36a57d9ce'
                        key: {
                            model: '36310466663c44eaaf626a257c82c464'
                            element: 'done'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'fe7b992f1c984c608c90c40959bc4452'
                        key: {
                            name: 'var__m_sys_hub_action_input_ad51a18ef8234860adcc24dfc962b590'
                            element: 'threshold'
                            language: 'en'
                        }
                    },
                ]
            }
        }
    }
}
