import type { APIContext } from "astro"
import { readAuthSettings } from "./auth"
import { CompanyError, getCompanyStore } from "./company-store"
import { readCompanySession } from "./company-session"
import { AuditLedger } from "./audit-ledger"
import { submitAuditDigest, upgradeAuditProof, verifyAuditProof } from "./audit-ots"

async function auditRequest(
    store: ReturnType<typeof getCompanyStore>,
    actor: NonNullable<APIContext["locals"]["companyUser"]>,
    method: string,
    path: string[],
    vaultId?: string
) {
    const ledger = new AuditLedger(store)
    if (!path.length && method === "GET") return ledger.list(actor, vaultId)
    if (!path.length && method === "POST") {
        const seal = ledger.prepare(actor, vaultId)
        if (!seal.proof) {
            ledger.attempt(actor, seal.id, vaultId)
            let proof: string
            try {
                proof = await submitAuditDigest(seal.digest)
            } catch {
                throw new CompanyError(
                    503,
                    "Timestamp calendars are unavailable. Your local seal was preserved; retry later."
                )
            }
            ledger.saveProof(actor, seal.id, proof, vaultId)
        }
        return ledger.list(actor, vaultId)
    }
    if (path.length === 2 && path[1] === "download" && method === "GET") return ledger.download(actor, path[0], vaultId)
    if (path.length === 2 && path[1] === "verify" && method === "POST") {
        const seal = ledger.attempt(actor, path[0], vaultId)
        if (!seal.proof) throw new CompanyError(400, "Submit this seal before verifying it.")
        let proof: string, confirmation: Awaited<ReturnType<typeof verifyAuditProof>>
        try {
            proof = await upgradeAuditProof(seal.proof, seal.digest)
            confirmation = await verifyAuditProof(proof, seal.digest)
        } catch {
            throw new CompanyError(
                503,
                "Bitcoin verification could not be completed. No new confirmation was recorded."
            )
        }
        ledger.saveProof(actor, seal.id, proof, vaultId, confirmation)
        return ledger.list(actor, vaultId)
    }
    throw new CompanyError(404, "Not found.")
}

async function jsonBody(request: Request) {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
        throw new CompanyError(415, "Send a JSON request.")
    const reader = request.body?.getReader()
    if (!reader) throw new CompanyError(400, "Invalid request.")
    const chunks: Uint8Array[] = []
    let length = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.length
            if (length > 4 * 1024 * 1024) {
                await reader.cancel()
                throw new CompanyError(413, "The import is too large. Your local data was not changed.")
            }
            chunks.push(value)
        }
        const bytes = Buffer.concat(chunks)
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
        return value
    } catch (error) {
        if (error instanceof CompanyError) throw error
        throw new CompanyError(400, "Invalid request.")
    }
}

export async function companyHandler(context: APIContext): Promise<Response> {
    try {
        let actor = context.locals.companyUser
        const settings = readAuthSettings()
        if (!actor || settings.mode !== "google") throw new CompanyError(401, "Please sign in again.")
        const request = context.request,
            method = request.method
        let parts: string[]
        try {
            parts = (context.params.path ?? "").split("/").filter(Boolean).map(decodeURIComponent)
        } catch {
            throw new CompanyError(400, "Invalid request.")
        }
        let body: any = null
        if (method !== "GET") {
            if (request.headers.get("origin") !== settings.origin || request.headers.get("x-vault-request") !== "1")
                throw new CompanyError(403, "Invalid request origin.")
            body = await jsonBody(request)
            // A user can be disabled/revoked while a slow request body is being received.
            const refreshed = await readCompanySession(request, settings)
            if (!refreshed.user || refreshed.user.id !== actor.id) throw new CompanyError(401, "Please sign in again.")
            actor = refreshed.user
        }
        const store = getCompanyStore()
        let result: unknown
        if (!parts.length && method === "GET") result = { me: actor, vaults: store.listVaults(actor) }
        else if (parts.length === 1 && parts[0] === "vaults" && method === "POST")
            result = store.createVault(actor, body.name)
        else if (parts[0] === "vaults" && parts[1]) {
            const id = parts[1]
            if (parts.length === 2 && method === "GET") result = store.getVault(actor, id)
            else if (parts.length === 2 && method === "PATCH")
                result = store.renameVault(actor, id, body.name, body.version)
            else if (parts.length === 2 && method === "DELETE") {
                store.deleteVault(actor, id, body.version)
                result = { ok: true }
            } else if (parts[2] === "items" && parts.length === 3 && method === "POST")
                result = store.saveItem(actor, id, body.content)
            else if (parts[2] === "items" && parts.length === 5 && parts[4] === "pin" && method === "POST")
                result = store.setPinned(actor, id, parts[3], body.pinned)
            else if (parts[2] === "items" && parts.length === 5 && parts[4] === "copy" && method === "POST")
                result = store.copyItem(actor, id, parts[3], body.field)
            else if (parts[2] === "items" && parts.length === 4 && method === "PATCH")
                result = store.saveItem(actor, id, body.content, parts[3], body.version)
            else if (parts[2] === "items" && parts.length === 4 && method === "DELETE") {
                store.deleteItem(actor, id, parts[3], body.version)
                result = { ok: true }
            } else if (parts[2] === "members" && parts.length === 3 && method === "GET")
                result = store.listMembers(actor, id)
            else if (parts[2] === "members" && parts.length === 3 && method === "POST")
                result = store.share(actor, id, body.email, body.role, settings.policy)
            else if (parts[2] === "members" && parts.length === 4 && method === "DELETE") {
                store.removeMember(actor, id, parts[3])
                result = { ok: true }
            } else if (parts[2] === "audit" && parts[3] === "events" && parts.length === 4 && method === "GET")
                result = store.getAuditPage(actor, context.url.searchParams, id)
            else if (parts[2] === "audit" && parts[3] === "seals")
                result = await auditRequest(store, actor, method, parts.slice(4), id)
            else if (parts[2] === "audit" && parts.length === 3 && method === "GET") result = store.getAudit(actor, id)
            else throw new CompanyError(404, "Not found.")
        } else if (parts.join("/") === "admin/audit/events" && method === "GET")
            result = store.getAuditPage(actor, context.url.searchParams)
        else if (parts[0] === "admin" && parts[1] === "audit" && parts[2] === "seals")
            result = await auditRequest(store, actor, method, parts.slice(3))
        else if (parts.join("/") === "export" && method === "POST") result = store.exportData(actor, body.vaultIds)
        else if (parts.join("/") === "import" && method === "POST") result = store.importLocal(actor, body)
        else if (parts.join("/") === "me/revoke-sessions" && method === "POST") {
            store.revokeSessions(actor)
            result = { ok: true }
        } else if (parts.join("/") === "admin" && method === "GET") result = store.adminData(actor)
        else if (
            parts[0] === "admin" &&
            parts[1] === "vaults" &&
            parts[3] === "recover" &&
            parts.length === 4 &&
            method === "POST"
        ) {
            store.recoverVault(actor, parts[2])
            result = { ok: true }
        } else if (parts[0] === "admin" && parts[1] === "users" && parts.length === 4 && method === "POST") {
            if (parts[3] === "revoke") store.revokeSessions(actor, parts[2])
            else if (parts[3] === "status") store.setDisabled(actor, parts[2], body.disabled)
            else throw new CompanyError(404, "Not found.")
            result = { ok: true }
        } else throw new CompanyError(404, "Not found.")
        return Response.json(result, {
            headers: {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
            }
        })
    } catch (error) {
        const status = error instanceof CompanyError ? error.status : 500
        return Response.json(
            {
                error: error instanceof CompanyError ? error.message : "Could not complete the operation. Please retry."
            },
            {
                status,
                headers: {
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff"
                }
            }
        )
    }
}
