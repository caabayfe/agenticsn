import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_subflow: {
                        table: 'sys_hub_flow'
                        id: '31888791f4594307add669e28d45f8b3'
                    }
                    a2_subflow_call: {
                        table: 'sys_hub_sub_flow_instance_v2'
                        id: '1e37d4987dce400db3938846ec9bdeeb'
                    }
                    a2_subflow_caller: {
                        table: 'sys_hub_flow'
                        id: '97fb0397e7174772ba77e6df81f7acfb'
                    }
                    a2_subflow_check: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '83fb8187adcf467e984f7ce574d41719'
                    }
                    a2_subflow_end: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'cf4f8bf255ad45f3a0b5855a1faf4f00'
                    }
                    a2_subflow_note: {
                        table: 'sys_hub_action_instance_v2'
                        id: 'e79662c6e51b4969ab94e150fc219808'
                    }
                    a2_subflow_out: {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '829114dab9c241e6b0436ec775e81077'
                    }
                    a2_subflow_trigger: {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '0295a37238eb42a4a25bfb8851e847e3'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '65f9d02b816f4deeba0e8829b752f62a'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '3e6c7f88c8f64845ba9cb4f41453ad8d'
                    }
                }
                composite: [
                    {
                        table: 'sys_hub_flow_input'
                        id: '2c1100eb1bf14de7951102868aa661af'
                        key: {
                            model: '31888791f4594307add669e28d45f8b3'
                            element: 'incident'
                        }
                    },
                    {
                        table: 'sys_hub_flow_output'
                        id: '658f7d59ca984eb3bbcdaa19b182c337'
                        key: {
                            model: '31888791f4594307add669e28d45f8b3'
                            element: 'done'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'a609152dfd774ec4b4bfe314c161f0c5'
                        key: {
                            name: 'var__m_sys_hub_flow_input_31888791f4594307add669e28d45f8b3'
                            element: 'incident'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'a9dfd9a015d640488a968a5e8d0ec939'
                        key: {
                            name: 'var__m_sys_hub_flow_output_31888791f4594307add669e28d45f8b3'
                            element: 'done'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_hub_flow_input'
                        id: 'd19be9642eae40988558d67b72fb3f9b'
                        key: {
                            model: '31888791f4594307add669e28d45f8b3'
                            element: 'note'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'f2f5225db0dd4032bdc8519a4266956e'
                        key: {
                            name: 'var__m_sys_hub_flow_input_31888791f4594307add669e28d45f8b3'
                            element: 'note'
                            language: 'en'
                        }
                    },
                ]
            }
        }
    }
}
