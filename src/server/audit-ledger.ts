import { createHash, randomBytes, randomUUID } from "node:crypto"
import { CompanyError, type CompanyStore } from "./company-store"
import type { CompanyUser } from "../interfaces/company"
import { readAuditProof } from "./audit-ots"

export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
type Seal = {
    id: string
    scope: string
    manifest: string
    digest: string
    first_id: number
    last_id: number
    created_at: number
    proof: string | null
    submitted_at: number | null
    checked_at: number | null
    block_height: number | null
    block_hash: string | null
    block_time: number | null
    attempted_at: number
}

export class AuditLedger {
    constructor(
        private store: CompanyStore,
        private automatic = false
    ) {}
    private scope(actor: CompanyUser, vaultId?: string) {
        if (!this.automatic) this.store.authorizeAudit(actor, vaultId)
        return vaultId ? `vault:${vaultId}` : "global"
    }
    private rows(scope: string, after = 0, through = Number.MAX_SAFE_INTEGER) {
        return this.store.db
            .prepare(
                `SELECT id,vault_id,actor_id,actor_email,action,target,created_at FROM company_audit
            WHERE id>? AND id<=? ${scope === "global" ? "" : "AND vault_id=?"} ORDER BY id LIMIT 5001`
            )
            .all(...[after, through, ...(scope === "global" ? [] : [scope.slice(6)])]) as Record<string, any>[]
    }
    private snapshot(scope: string, salt: string, after: number, through: number) {
        return this.rows(scope, after, through).map((row) => [
            row.id,
            hash(
                JSON.stringify([
                    "latamware-audit-event-v1",
                    salt,
                    row.id,
                    row.vault_id,
                    row.actor_id,
                    row.actor_email,
                    row.action,
                    row.target,
                    row.created_at
                ])
            )
        ])
    }
    private seals(scope: string) {
        return this.store.db
            .prepare("SELECT * FROM company_audit_seals WHERE scope=? ORDER BY last_id,id")
            .all(scope) as Seal[]
    }
    private valid(seal: Seal, previous: string | null): boolean {
        try {
            if (seal.proof) readAuditProof(seal.proof, seal.digest)
            const manifest = JSON.parse(seal.manifest)
            return (
                hash(seal.manifest) === seal.digest &&
                manifest.format === "latamware-audit-v1" &&
                manifest.id === seal.id &&
                manifest.scope === seal.scope &&
                manifest.previousDigest === previous &&
                manifest.createdAt === seal.created_at &&
                typeof manifest.salt === "string" &&
                /^[a-f0-9]{64}$/.test(manifest.salt) &&
                manifest.firstId === seal.first_id &&
                manifest.lastId === seal.last_id &&
                JSON.stringify(manifest.events) ===
                    JSON.stringify(this.snapshot(seal.scope, manifest.salt, seal.first_id - 1, seal.last_id))
            )
        } catch {
            return false
        }
    }
    list(actor: CompanyUser, vaultId?: string) {
        const scope = this.scope(actor, vaultId),
            seals = this.seals(scope)
        let previous: string | null = null,
            intact = true
        const batches = seals.map((seal) => {
            intact = intact && this.valid(seal, previous)
            previous = seal.digest
            let eventCount = 0
            try {
                const events = JSON.parse(seal.manifest).events
                eventCount = Array.isArray(events) ? events.length : 0
            } catch {
                /* Display damaged seals for investigation. */
            }
            return {
                id: seal.id,
                digest: seal.digest,
                eventCount,
                firstId: seal.first_id,
                lastId: seal.last_id,
                createdAt: seal.created_at,
                integrity: intact ? "intact" : "changed",
                state: seal.block_height ? "confirmed" : seal.proof ? "pending" : "unsubmitted",
                checkedAt: seal.checked_at,
                blockHeight: seal.block_height,
                blockHash: seal.block_hash,
                blockTime: seal.block_time
            }
        })
        const count = this.store.db
            .prepare(`SELECT count(*) n FROM company_audit WHERE id>? ${scope === "global" ? "" : "AND vault_id=?"}`)
            .get(...[seals.at(-1)?.last_id ?? 0, ...(scope === "global" ? [] : [scope.slice(6)])]) as { n: number }
        return { integrity: intact ? "intact" : "changed", unsealedCount: count.n, batches: batches.toReversed() }
    }
    prepare(actor: CompanyUser, vaultId?: string): Seal {
        const scope = this.scope(actor, vaultId),
            db = this.store.db
        db.exec("BEGIN IMMEDIATE")
        try {
            if (this.list(actor, vaultId).integrity !== "intact")
                throw new CompanyError(
                    409,
                    "The sealed activity has changed. Investigate before creating another seal."
                )
            const seals = this.seals(scope),
                latest = seals.at(-1)
            if (latest && !latest.proof) {
                db.exec("COMMIT")
                return latest
            }
            const events = this.rows(scope, latest?.last_id ?? 0).slice(0, 5000)
            if (!events.length) {
                if (!latest) throw new CompanyError(400, "There is no activity to seal.")
                db.exec("COMMIT")
                return latest
            }
            if (latest && Date.now() - latest.created_at < 60000)
                throw new CompanyError(429, "Wait one minute before creating another seal.")
            const id = randomUUID(),
                salt = randomBytes(32).toString("hex"),
                createdAt = Date.now()
            const firstId = events[0].id,
                lastId = events.at(-1)!.id
            const manifest = JSON.stringify({
                format: "latamware-audit-v1",
                id,
                scope,
                createdAt,
                createdBy: hash(JSON.stringify([salt, actor.id])),
                salt,
                previousDigest: latest?.digest ?? null,
                firstId,
                lastId,
                events: this.snapshot(scope, salt, firstId - 1, lastId)
            })
            db.prepare(
                "INSERT INTO company_audit_seals(id,scope,manifest,digest,first_id,last_id,created_at) VALUES(?,?,?,?,?,?,?)"
            ).run(id, scope, manifest, hash(manifest), firstId, lastId, createdAt)
            const seal = db.prepare("SELECT * FROM company_audit_seals WHERE id=?").get(id) as Seal
            db.exec("COMMIT")
            return seal
        } catch (reason) {
            db.exec("ROLLBACK")
            throw reason
        }
    }
    get(actor: CompanyUser, id: string, vaultId?: string): Seal {
        const scope = this.scope(actor, vaultId)
        const seal = this.store.db
            .prepare("SELECT * FROM company_audit_seals WHERE id=? AND scope=?")
            .get(id, scope) as Seal | undefined
        if (!seal) throw new CompanyError(404, "Seal not found.")
        if (this.list(actor, vaultId).integrity !== "intact")
            throw new CompanyError(409, "The sealed activity has changed. Investigate before creating another seal.")
        return seal
    }
    attempt(actor: CompanyUser, id: string, vaultId?: string) {
        const seal = this.get(actor, id, vaultId)
        if (Date.now() - seal.attempted_at < 30000)
            throw new CompanyError(429, "Wait 30 seconds before checking this seal again.")
        this.store.db.prepare("UPDATE company_audit_seals SET attempted_at=? WHERE id=?").run(Date.now(), id)
        return seal
    }
    saveProof(
        actor: CompanyUser,
        id: string,
        proof: string,
        vaultId?: string,
        confirmation?: { height: number; hash: string; time: number }
    ) {
        const seal = this.get(actor, id, vaultId) // Recheck membership/integrity after network waits.
        readAuditProof(proof, seal.digest)
        this.store.db
            .prepare(
                `UPDATE company_audit_seals SET proof=?,submitted_at=coalesce(submitted_at,?),checked_at=?,
            block_height=?,block_hash=?,block_time=? WHERE id=?`
            )
            .run(
                proof,
                Date.now(),
                Date.now(),
                confirmation?.height ?? null,
                confirmation?.hash ?? null,
                confirmation?.time ?? null,
                id
            )
    }
    download(actor: CompanyUser, id: string, vaultId?: string) {
        const seal = this.get(actor, id, vaultId)
        return { format: "latamware-audit-proof-v1", manifest: seal.manifest, digest: seal.digest, ots: seal.proof }
    }
}
