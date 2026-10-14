import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    a2_business_rule: {
                        table: 'sys_script'
                        id: '675148d6ff58421984f302f01c53510b'
                    }
                    a2_script_include: {
                        table: 'sys_script_include'
                        id: 'a14d2e8ca64c41279df2258d038f9bc1'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '69d74e1587274d5ca097a7453aa3b2ae'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '61333053ab824ed781fa82790cc921f7'
                    }
                    'src_server_a2-note_ts': {
                        table: 'sys_module'
                        id: 'd54ee2e5990447e3842258e9ceccd5dc'
                    }
                    'src_server_script-includes_a2-utils_js': {
                        table: 'sys_module'
                        id: '270dd79e25774f3f9e635e79d4fc204f'
                    }
                }
            }
        }
    }
}
