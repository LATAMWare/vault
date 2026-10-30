import { getCompanyStore, type CompanyStore } from "./company-store"
import { AuditLedger } from "./audit-ledger"
import { submitAuditDigest, upgradeAuditProof, verifyAuditProof } from "./audit-ots"

export const SEAL_INTERVAL = 5 * 60 * 1000
const VERIFY_INTERVAL = 15 * 60 * 1000
const SYSTEM = { id: "system:automatic-audit", email: "", isAdmin: false }
const defaults = { submit: submitAuditDigest, upgrade: upgradeAuditProof, verify: verifyAuditProof }
let timer: ReturnType<typeof setInterval> | undefined
let running = false

/** Single-process job. Its internal capability is never selected by an HTTP parameter. */
export async function runAuditWorkerOnce(store: CompanyStore, now = Date.now(), transport = defaults) {
    const ledger = new AuditLedger(store, true)
    const scopes = store.db
        .prepare(
            `SELECT 'global' scope,min(created_at) oldest FROM company_audit
        UNION ALL SELECT 'vault:'||vault_id scope,min(created_at) oldest FROM company_audit WHERE vault_id IS NOT NULL GROUP BY vault_id`
        )
        .all() as { scope: string; oldest: number | null }[]
    let submitted = 0,
        failed = 0
    for (const scope of scopes) {
        if (scope.oldest === null || submitted >= 5) continue
        const vaultId = scope.scope === "global" ? undefined : scope.scope.slice(6)
        const last = store.db
            .prepare("SELECT * FROM company_audit_seals WHERE scope=? ORDER BY last_id DESC LIMIT 1")
            .get(scope.scope) as Record<string, any> | undefined
        const fresh = store.db
            .prepare(`SELECT min(created_at) oldest FROM company_audit WHERE id>? ${vaultId ? "AND vault_id=?" : ""}`)
            .get(...[last?.last_id ?? 0, ...(vaultId ? [vaultId] : [])]) as { oldest: number | null }
        if (last && !last.proof) {
            if (now - last.attempted_at < SEAL_INTERVAL) continue
        } else if (fresh.oldest === null || now - (last?.created_at ?? fresh.oldest) < SEAL_INTERVAL) continue
        try {
            const seal = ledger.prepare(SYSTEM, vaultId)
            if (seal.proof) continue
            ledger.attempt(SYSTEM, seal.id, vaultId)
            submitted++
            const proof = await transport.submit(seal.digest)
            ledger.saveProof(SYSTEM, seal.id, proof, vaultId)
        } catch {
            failed++
        }
    }
    const pending = store.db
        .prepare(
            "SELECT id,scope FROM company_audit_seals WHERE proof IS NOT NULL AND block_height IS NULL AND attempted_at<=? ORDER BY attempted_at LIMIT 2"
        )
        .all(now - VERIFY_INTERVAL) as { id: string; scope: string }[]
    for (const entry of pending) {
        const vaultId = entry.scope === "global" ? undefined : entry.scope.slice(6)
        try {
            const seal = ledger.attempt(SYSTEM, entry.id, vaultId)
            const proof = await transport.upgrade(seal.proof!, seal.digest)
            const confirmation = await transport.verify(proof, seal.digest)
            ledger.saveProof(SYSTEM, seal.id, proof, vaultId, confirmation)
        } catch {
            failed++
        }
    }
    return { submitted, failed }
}

export function ensureAuditWorker() {
    if (timer || process.env.VAULT_AUDIT_AUTO === "false") return
    const tick = async () => {
        if (running) return
        running = true
        try {
            await runAuditWorkerOnce(getCompanyStore())
        } catch {
            /* Configuration may change while restarting. */
        } finally {
            running = false
        }
    }
    timer = setInterval(() => void tick(), 60000)
    timer.unref()
    const initial = setTimeout(() => void tick(), 1000)
    initial.unref()
}
