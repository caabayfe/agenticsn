import { BusinessRule, ScriptInclude } from '@servicenow/sdk/core'
import { a2Note } from '../server/a2-note'

// A2 server-modules: a script include (string script) and a business rule from a server module.
ScriptInclude({
    $id: Now.ID['a2_script_include'],
    name: 'A2Utils',
    script: Now.include('../server/script-includes/a2-utils.js'),
    description: 'snagentic test A2 script include',
})

BusinessRule({
    $id: Now.ID['a2_business_rule'],
    name: 'snagentic test A2 business rule',
    table: 'incident',
    when: 'after',
    action: ['update'],
    script: a2Note,
})
