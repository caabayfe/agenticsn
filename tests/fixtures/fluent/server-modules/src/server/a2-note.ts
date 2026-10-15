import { gs, GlideRecord } from '@servicenow/glide'

// A server module: modern TypeScript, bundled by the SDK.
export function a2Note(current: GlideRecord<'incident'>, previous: GlideRecord<'incident'>) {
    const from = previous.getValue('priority')
    const to = current.getValue('priority')
    if (from !== to) {
        gs.info(`snagentic test A2: priority ${from} -> ${to}`)
    }
}
