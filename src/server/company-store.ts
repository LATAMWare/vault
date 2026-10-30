import { DatabaseSync } from "node:sqlite"
import { mkdirSync, chmodSync, existsSync } from "node:fs"
import { dirname, isAbsolute } from "node:path"
import { randomBytes, randomUUID } from "node:crypto"
import { decrypt, encrypt, unwrapKey, wrapKey } from "./company-crypto"
import { parseAccessPolicy, type AccessPolicy } from "./access-policy"
import type { CompanyUser, ItemContent, VaultRole, CompanyVault, CompanyItem } from "../interfaces/company"

export class CompanyError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message)
    }
}
export interface CompanySettings {
    path: string
    keys: Record<string, Buffer>
    activeKey: string
    admins: string[]
}
type Row = Record<string, any>
const normalizeEmail = (email: string) => email.trim().toLowerCase()
export function readCompanySettings(
    env: Record<string, string | undefined> = import.meta.env?.DEV
        ? { ...import.meta.env, ...process.env }
        : process.env
): CompanySettings {
    const path = env.VAULT_DATABASE_PATH ?? ""
    if (!isAbsolute(path)) throw new Error("VAULT_DATABASE_PATH must be an absolute path")
    let raw: Record<string, unknown>
    try {
        raw = JSON.parse(env.VAULT_ENCRYPTION_KEYS ?? "")
    } catch {
        throw new Error("Company encryption keys are not configured")
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid company key ring")
    const keys: Record<string, Buffer> = Object.create(null)
    for (const [id, value] of Object.entries(raw)) {
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || typeof value !== "string") throw new Error("Invalid company key ring")
        const bytes = Buffer.from(value, "base64")
        if (bytes.length !== 32 || bytes.toString("base64") !== value)
            throw new Error("Company encryption keys must be 32 random bytes in Base64")
        keys[id] = bytes
    }
    const activeKey = env.VAULT_ACTIVE_KEY_ID ?? "v1"
    if (!Object.hasOwn(keys, activeKey)) throw new Error("Active company encryption key is missing")
    const admins = (env.VAULT_ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean)
    for (const email of admins) parseAccessPolicy("", email)
    if (!admins.length) throw new Error("At least one company administrator is required")
    return { path, keys, activeKey, admins }
}

export function text(value: unknown, max: number, required = false): string {
    if (typeof value !== "string" || value.length > max || (required && !value.trim()))
        throw new CompanyError(400, "Check the required fields and their length.")
    return value
}
function version(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new CompanyError(400, "A current version is required.")
    return Number(value)
}
export function itemContent(value: any): ItemContent {
    if (!value || !["password", "note"].includes(value.kind)) throw new CompanyError(400, "Select a valid item type.")
    return {
        kind: value.kind,
        title: text(value.title, 200, true).trim(),
        username: text(value.username ?? "", 1000),
        password: text(value.password ?? "", 16384, value.kind === "password"),
        url: text(value.url ?? "", 2048),
        notes: text(value.notes ?? "", 131072, value.kind === "note")
    }
}

export class CompanyStore {
    readonly db: DatabaseSync
    constructor(readonly settings: CompanySettings) {
        mkdirSync(dirname(settings.path), { recursive: true, mode: 0o700 })
        this.db = new DatabaseSync(settings.path)
        try {
            const schemaVersion = (this.db.prepare("PRAGMA user_version").get() as Row).user_version
            if (schemaVersion > 3) throw new Error("Unsupported company database version")
            if (process.platform !== "win32") chmodSync(settings.path, 0o600)
            this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS company_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS company_users (
                    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, disabled INTEGER NOT NULL DEFAULT 0,
                    revoked_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS company_vaults (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES company_users(id),
                    wrapped_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS company_members (
                    id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES company_vaults(id) ON DELETE CASCADE,
                    user_id TEXT REFERENCES company_users(id), invited_email TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','reader')), created_at INTEGER NOT NULL,
                    UNIQUE(vault_id, invited_email), UNIQUE(vault_id, user_id));
                CREATE TABLE IF NOT EXISTS company_items (
                    id TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES company_vaults(id) ON DELETE CASCADE,
                    payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS company_pins (
                    user_id TEXT NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
                    item_id TEXT NOT NULL REFERENCES company_items(id) ON DELETE CASCADE,
                    PRIMARY KEY(user_id,item_id));
                CREATE TABLE IF NOT EXISTS company_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, vault_id TEXT, actor_id TEXT NOT NULL,
                    actor_email TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS company_imports (
                    user_id TEXT NOT NULL REFERENCES company_users(id), source_id TEXT NOT NULL,
                    result TEXT NOT NULL, PRIMARY KEY(user_id, source_id));
                CREATE TABLE IF NOT EXISTS company_audit_seals (
                    id TEXT PRIMARY KEY, scope TEXT NOT NULL, manifest TEXT NOT NULL, digest TEXT NOT NULL,
                    first_id INTEGER NOT NULL,last_id INTEGER NOT NULL,created_at INTEGER NOT NULL,
                    proof TEXT,submitted_at INTEGER,checked_at INTEGER,block_height INTEGER,block_hash TEXT,block_time INTEGER,
                    attempted_at INTEGER NOT NULL DEFAULT 0, UNIQUE(scope,last_id));
                CREATE INDEX IF NOT EXISTS company_member_users ON company_members(user_id);
                CREATE INDEX IF NOT EXISTS company_pending_emails ON company_members(invited_email) WHERE user_id IS NULL;
                CREATE INDEX IF NOT EXISTS company_item_vaults ON company_items(vault_id);
                CREATE INDEX IF NOT EXISTS company_audit_vaults ON company_audit(vault_id, id);`)
            this.db.exec("PRAGMA user_version=3")
            for (const row of this.all("SELECT id,wrapped_key FROM company_vaults"))
                unwrapKey(row.wrapped_key, row.id, settings.keys)
        } catch (error) {
            this.db.close()
            throw error
        }
    }
    close() {
        this.db.close()
    }
    private one(sql: string, ...values: (string | number | null)[]): Row | undefined {
        return this.db.prepare(sql).get(...values) as Row | undefined
    }
    private all(sql: string, ...values: (string | number | null)[]): Row[] {
        return this.db.prepare(sql).all(...values) as Row[]
    }
    private run(sql: string, ...values: (string | number | null)[]) {
        return this.db.prepare(sql).run(...values)
    }
    private transaction<T>(change: () => T): T {
        this.db.exec("BEGIN IMMEDIATE")
        try {
            const value = change()
            this.db.exec("COMMIT")
            return value
        } catch (error) {
            this.db.exec("ROLLBACK")
            throw error
        }
    }
    private audit(actor: CompanyUser, action: string, target: string, vaultId: string | null = null) {
        this.run(
            "INSERT INTO company_audit(vault_id,actor_id,actor_email,action,target,created_at) VALUES(?,?,?,?,?,?)",
            vaultId,
            actor.id,
            actor.email,
            action,
            target,
            Date.now()
        )
    }
    authenticate(identity: { id: string; email: string }, authenticatedAt: number): CompanyUser {
        if (!Number.isFinite(authenticatedAt)) throw new CompanyError(401, "Please sign in again.")
        // Check revocation on every request, but avoid a disk write/lock on every read.
        const known = this.one("SELECT * FROM company_users WHERE id=?", identity.id)
        if (known?.disabled) throw new CompanyError(403, "Your account is disabled. Contact the administrator.")
        if (known && authenticatedAt <= known.revoked_at) throw new CompanyError(401, "Please sign in again.")
        const normalized = normalizeEmail(identity.email)
        const isAdmin = this.settings.admins.includes(normalized)
        if (
            known?.email === normalized &&
            Date.now() - known.last_seen < 60000 &&
            !this.one("SELECT id FROM company_members WHERE user_id IS NULL AND invited_email=? LIMIT 1", normalized) &&
            (!isAdmin || this.one("SELECT value FROM company_meta WHERE key='initial-vault'"))
        )
            return { ...identity, email: normalized, isAdmin }
        return this.transaction(() => {
            const current = this.one("SELECT * FROM company_users WHERE id=?", identity.id)
            if (current?.disabled) throw new CompanyError(403, "Your account is disabled. Contact the administrator.")
            if (current && authenticatedAt <= current.revoked_at) throw new CompanyError(401, "Please sign in again.")
            const email = normalizeEmail(identity.email)
            const collision = this.one("SELECT id FROM company_users WHERE email=? AND id<>?", email, identity.id)
            if (collision) throw new CompanyError(403, "Contact the administrator to recover this identity.")
            this.run(
                `INSERT INTO company_users(id,email,created_at,last_seen) VALUES(?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET email=excluded.email,last_seen=excluded.last_seen`,
                identity.id,
                email,
                Date.now(),
                Date.now()
            )
            const actor = {
                ...identity,
                email,
                isAdmin: this.settings.admins.includes(email)
            }
            if (!current) this.audit(actor, "user.joined", identity.id)
            // Invitations bind once to Google's immutable subject, never to a mutable email thereafter.
            this.run(
                `UPDATE company_members AS invitation SET user_id=? WHERE user_id IS NULL AND invited_email=?
                AND NOT EXISTS(SELECT 1 FROM company_members existing WHERE existing.vault_id=invitation.vault_id AND existing.user_id=?)`,
                actor.id,
                email,
                actor.id
            )
            if (actor.isAdmin && !this.one("SELECT value FROM company_meta WHERE key='initial-vault'")) {
                const initial = this.insertVault(actor, "General")
                this.run("INSERT INTO company_meta(key,value) VALUES('initial-vault',?)", initial.id)
            }
            return actor
        })
    }
    private member(actor: CompanyUser, vaultId: string, roles?: VaultRole[]): Row {
        const row = this.one(
            `SELECT v.*,m.role FROM company_vaults v JOIN company_members m ON m.vault_id=v.id
            WHERE v.id=? AND m.user_id=?`,
            vaultId,
            actor.id
        )
        if (!row) throw new CompanyError(404, "Vault not found or access was removed.")
        if (roles && !roles.includes(row.role))
            throw new CompanyError(403, "You do not have permission for this action.")
        return row
    }
    private key(row: Row) {
        return unwrapKey(row.wrapped_key, row.id, this.settings.keys)
    }
    private summary(row: Row): CompanyVault {
        return {
            id: row.id,
            name: row.name,
            role: row.role,
            version: row.version,
            updatedAt: row.updated_at,
            itemCount:
                row.item_count ??
                this.one("SELECT count(*) AS total FROM company_items WHERE vault_id=?", row.id)!.total
        }
    }
    listVaults(actor: CompanyUser): CompanyVault[] {
        return this.all(
            `SELECT v.id,v.name,v.version,v.updated_at,m.role,
            (SELECT count(*) FROM company_items i WHERE i.vault_id=v.id) AS item_count
            FROM company_vaults v JOIN company_members m ON m.vault_id=v.id
            WHERE m.user_id=? ORDER BY v.name COLLATE NOCASE,v.id`,
            actor.id
        ).map((row) => this.summary(row))
    }
    getVault(actor: CompanyUser, vaultId: string) {
        const row = this.member(actor, vaultId),
            key = this.key(row)
        const items: CompanyItem[] = this.all(
            `SELECT i.*,p.item_id IS NOT NULL AS pinned FROM company_items i
            LEFT JOIN company_pins p ON p.item_id=i.id AND p.user_id=?
            WHERE i.vault_id=? ORDER BY pinned DESC,i.updated_at DESC,i.id`,
            actor.id,
            vaultId
        ).map((item) => ({
            ...itemContent(
                JSON.parse(decrypt(key, JSON.parse(item.payload), `vault-item:${vaultId}:${item.id}:${item.version}`))
            ),
            id: item.id,
            version: item.version,
            updatedAt: item.updated_at,
            pinned: Boolean(item.pinned)
        }))
        return { ...this.summary(row), items }
    }
    setPinned(actor: CompanyUser, vaultId: string, itemId: string, pinned: unknown) {
        return this.transaction(() => {
            this.member(actor, vaultId)
            if (typeof pinned !== "boolean") throw new CompanyError(400, "Invalid request.")
            if (!this.one("SELECT id FROM company_items WHERE id=? AND vault_id=?", itemId, vaultId))
                throw new CompanyError(404, "Not found.")
            if (pinned) this.run("INSERT OR IGNORE INTO company_pins(user_id,item_id) VALUES(?,?)", actor.id, itemId)
            else this.run("DELETE FROM company_pins WHERE user_id=? AND item_id=?", actor.id, itemId)
            return { pinned }
        })
    }
    copyItem(actor: CompanyUser, vaultId: string, itemId: string, field: unknown) {
        return this.transaction(() => {
            const row = this.member(actor, vaultId)
            if (typeof field !== "string" || !["password", "username", "notes"].includes(field))
                throw new CompanyError(400, "Invalid request.")
            const item = this.one("SELECT * FROM company_items WHERE id=? AND vault_id=?", itemId, vaultId)
            if (!item) throw new CompanyError(404, "Not found.")
            const content = itemContent(
                JSON.parse(
                    decrypt(this.key(row), JSON.parse(item.payload), `vault-item:${vaultId}:${item.id}:${item.version}`)
                )
            )
            if ((field === "password" || field === "username") && content.kind !== "password")
                throw new CompanyError(400, "Invalid request.")
            this.audit(actor, `item.${field}_copy_requested`, content.title, vaultId)
            return { value: content[field as "password" | "username" | "notes"] }
        })
    }
    exportData(actor: CompanyUser, vaultIds: unknown) {
        if (
            !Array.isArray(vaultIds) ||
            !vaultIds.length ||
            vaultIds.length > 200 ||
            vaultIds.some((id) => typeof id !== "string") ||
            new Set(vaultIds).size !== vaultIds.length
        )
            throw new CompanyError(400, "Select at least one vault.")
        return this.transaction(() => {
            const vaults = vaultIds.map((id) => {
                const vault = this.getVault(actor, id)
                return { name: vault.name, items: vault.items.map(itemContent) }
            })
            const payload = {
                format: "latamware-company-backup",
                version: 1,
                sourceId: randomUUID(),
                exportedAt: new Date().toISOString(),
                vaults
            }
            if (Buffer.byteLength(JSON.stringify(payload)) > 4 * 1024 * 1024)
                throw new CompanyError(413, "The backup is too large. Select fewer vaults.")
            for (let index = 0; index < vaultIds.length; index++)
                this.audit(actor, "vault.exported", vaults[index].name, vaultIds[index])
            return payload
        })
    }
    private insertVault(actor: CompanyUser, name: string) {
        const id = randomUUID(),
            key = randomBytes(32)
        this.run(
            "INSERT INTO company_vaults(id,name,owner_id,wrapped_key,updated_at) VALUES(?,?,?,?,?)",
            id,
            name,
            actor.id,
            wrapKey(key, id, this.settings.activeKey, this.settings.keys[this.settings.activeKey]),
            Date.now()
        )
        this.run(
            "INSERT INTO company_members(id,vault_id,user_id,invited_email,role,created_at) VALUES(?,?,?,?,?,?)",
            randomUUID(),
            id,
            actor.id,
            actor.email,
            "owner",
            Date.now()
        )
        this.audit(actor, "vault.created", name, id)
        return this.summary(this.member(actor, id))
    }
    createVault(actor: CompanyUser, name: unknown) {
        return this.transaction(() => this.insertVault(actor, text(name, 160, true).trim()))
    }
    renameVault(actor: CompanyUser, id: string, name: unknown, expectedVersion: unknown) {
        return this.transaction(() => {
            const row = this.member(actor, id, ["owner", "admin"])
            if (row.version !== version(expectedVersion))
                throw new CompanyError(409, "This vault changed. Refresh it before saving.")
            this.run(
                "UPDATE company_vaults SET name=?,version=version+1,updated_at=? WHERE id=?",
                text(name, 160, true).trim(),
                Date.now(),
                id
            )
            this.audit(actor, "vault.renamed", String(name).trim(), id)
            return this.summary(this.member(actor, id))
        })
    }
    deleteVault(actor: CompanyUser, id: string, expectedVersion: unknown) {
        this.transaction(() => {
            const row = this.member(actor, id, ["owner"])
            if (row.version !== version(expectedVersion))
                throw new CompanyError(409, "This vault changed. Refresh it before saving.")
            this.audit(actor, "vault.deleted", row.name, id)
            this.run("DELETE FROM company_vaults WHERE id=?", id)
        })
    }
    saveItem(actor: CompanyUser, vaultId: string, input: unknown, id?: string, expectedVersion?: unknown) {
        return this.transaction(() => {
            const row = this.member(actor, vaultId, ["owner", "admin", "editor"]),
                payload = itemContent(input)
            let nextVersion = 1
            if (id) {
                const current = this.one("SELECT version FROM company_items WHERE id=? AND vault_id=?", id, vaultId)
                if (!current) throw new CompanyError(404, "Item no longer exists.")
                if (current.version !== version(expectedVersion))
                    throw new CompanyError(409, "This item changed. Refresh it before saving.")
                nextVersion = current.version + 1
            } else id = randomUUID()
            this.run(
                `INSERT INTO company_items(id,vault_id,payload,version,updated_at) VALUES(?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at`,
                id,
                vaultId,
                JSON.stringify(
                    encrypt(this.key(row), JSON.stringify(payload), `vault-item:${vaultId}:${id}:${nextVersion}`)
                ),
                nextVersion,
                Date.now()
            )
            this.run("UPDATE company_vaults SET version=version+1,updated_at=? WHERE id=?", Date.now(), vaultId)
            this.audit(actor, nextVersion === 1 ? "item.created" : "item.updated", payload.title, vaultId)
            return { id, version: nextVersion }
        })
    }
    deleteItem(actor: CompanyUser, vaultId: string, id: string, expectedVersion: unknown) {
        this.transaction(() => {
            const vault = this.member(actor, vaultId, ["owner", "admin", "editor"])
            const current = this.one("SELECT * FROM company_items WHERE id=? AND vault_id=?", id, vaultId)
            if (!current) throw new CompanyError(404, "Item no longer exists.")
            if (current.version !== version(expectedVersion))
                throw new CompanyError(409, "This item changed. Refresh it before saving.")
            const deleted = itemContent(
                JSON.parse(
                    decrypt(
                        this.key(vault),
                        JSON.parse(current.payload),
                        `vault-item:${vaultId}:${id}:${current.version}`
                    )
                )
            )
            this.run("DELETE FROM company_items WHERE id=? AND vault_id=?", id, vaultId)
            this.run("UPDATE company_vaults SET version=version+1,updated_at=? WHERE id=?", Date.now(), vaultId)
            this.audit(actor, "item.deleted", deleted.title, vaultId)
        })
    }
    listMembers(actor: CompanyUser, vaultId: string) {
        this.member(actor, vaultId, ["owner", "admin"])
        return this.all(
            `SELECT m.id,coalesce(u.email,m.invited_email) AS email,m.role,m.user_id FROM company_members m
            LEFT JOIN company_users u ON u.id=m.user_id WHERE m.vault_id=? ORDER BY m.created_at`,
            vaultId
        ).map((row) => ({
            id: row.id,
            email: row.email,
            role: row.role,
            pending: row.user_id === null
        }))
    }
    share(actor: CompanyUser, vaultId: string, emailValue: unknown, role: unknown, policy: AccessPolicy) {
        const email = normalizeEmail(text(emailValue, 254, true))
        try {
            parseAccessPolicy("", email)
        } catch {
            throw new CompanyError(400, "Enter a valid email address.")
        }
        if (!policy.emails.includes(email) && !policy.domains.includes(email.split("@")[1]))
            throw new CompanyError(400, "This email must be allowed to enter the system first.")
        if (!["admin", "editor", "reader"].includes(String(role)))
            throw new CompanyError(400, "Select a valid permission.")
        this.transaction(() => {
            const vault = this.member(actor, vaultId, ["owner", "admin"])
            const target = this.one("SELECT id FROM company_users WHERE email=?", email)
            if (target?.id === vault.owner_id) throw new CompanyError(400, "The owner cannot be removed or demoted.")
            const member =
                target && this.one("SELECT id FROM company_members WHERE vault_id=? AND user_id=?", vaultId, target.id)
            if (member) this.run("UPDATE company_members SET role=? WHERE id=?", String(role), member.id)
            else
                this.run(
                    `INSERT INTO company_members(id,vault_id,user_id,invited_email,role,created_at) VALUES(?,?,?,?,?,?)
                ON CONFLICT(vault_id,invited_email) DO UPDATE SET role=excluded.role`,
                    randomUUID(),
                    vaultId,
                    target?.id ?? null,
                    email,
                    String(role),
                    Date.now()
                )
            this.audit(actor, "member.granted", email, vaultId)
        })
        return this.listMembers(actor, vaultId)
    }
    removeMember(actor: CompanyUser, vaultId: string, id: string) {
        this.transaction(() => {
            const vault = this.member(actor, vaultId, ["owner", "admin"])
            const target = this.one("SELECT * FROM company_members WHERE vault_id=? AND id=?", vaultId, id)
            if (!target) throw new CompanyError(404, "Member no longer exists.")
            if (target.user_id === vault.owner_id)
                throw new CompanyError(400, "The owner cannot be removed or demoted.")
            this.run("DELETE FROM company_members WHERE vault_id=? AND id=?", vaultId, id)
            this.audit(actor, "member.removed", target.invited_email, vaultId)
        })
    }
    getAudit(actor: CompanyUser, vaultId: string) {
        this.member(actor, vaultId, ["owner", "admin"])
        return this.auditRows("WHERE vault_id=?", [vaultId])
    }
    authorizeAudit(actor: CompanyUser, vaultId?: string) {
        if (vaultId) this.member(actor, vaultId, ["owner", "admin"])
        else this.admin(actor)
    }
    getAuditPage(actor: CompanyUser, input: URLSearchParams, vaultId?: string) {
        this.authorizeAudit(actor, vaultId)
        const pageText = input.get("page") ?? "1",
            page = Number(pageText)
        const snapshotText = input.get("asOf"),
            requestedSnapshot = snapshotText === null ? null : Number(snapshotText)
        const query = input.get("q")?.trim() ?? "",
            action = input.get("action") ?? ""
        if (
            !/^\d+$/.test(pageText) ||
            !Number.isSafeInteger(page) ||
            page < 1 ||
            (snapshotText !== null &&
                (!/^\d+$/.test(snapshotText) ||
                    !Number.isSafeInteger(requestedSnapshot) ||
                    Number(requestedSnapshot) < 0)) ||
            query.length > 200 ||
            action.length > 80
        )
            throw new CompanyError(400, "Invalid activity filter.")
        const filters: string[] = [],
            values: (string | number)[] = []
        if (vaultId) {
            filters.push("a.vault_id=?")
            values.push(vaultId)
        }
        const newest = this.one(
            `SELECT coalesce(max(a.id),0) id FROM company_audit a ${vaultId ? "WHERE a.vault_id=?" : ""}`,
            ...(vaultId ? [vaultId] : [])
        )!.id
        const asOf = requestedSnapshot === null ? newest : Math.min(newest, requestedSnapshot)
        filters.push("a.id<=?")
        values.push(asOf)
        if (query) {
            filters.push("instr(lower(a.actor_email || ' ' || a.target),lower(?))>0")
            values.push(query)
        }
        if (action) {
            filters.push("a.action=?")
            values.push(action)
        }
        const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
        const total = this.one(`SELECT count(*) total FROM company_audit a ${where}`, ...values)!.total
        const pages = Math.max(1, Math.ceil(total / 100))
        if (page > pages) throw new CompanyError(400, "Invalid activity filter.")
        const entries = this.auditRows(where, values, 100, (page - 1) * 100)
        return { entries, total, page, pages, asOf }
    }
    private auditRows(where = "", params: (string | number)[] = [], limit = 200, offset = 0) {
        return this.all(
            `SELECT a.id,a.action,a.actor_email AS actor,
            CASE WHEN a.action IN ('vault.created','vault.renamed','vault.imported','vault.recovered') AND a.target=a.vault_id
            THEN coalesce((SELECT v.name FROM company_vaults v WHERE v.id=a.vault_id),a.target)
            ELSE a.target END AS target,a.created_at AS createdAt
            FROM company_audit a ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
            ...params,
            limit,
            offset
        )
    }
    private admin(actor: CompanyUser) {
        if (!this.settings.admins.includes(actor.email))
            throw new CompanyError(403, "You do not have permission for this action.")
    }
    adminData(actor: CompanyUser) {
        this.admin(actor)
        return {
            users: this.all("SELECT id,email,disabled,last_seen AS lastSeen FROM company_users ORDER BY email"),
            vaults: this.all(
                "SELECT v.id,v.name,u.email AS owner FROM company_vaults v JOIN company_users u ON u.id=v.owner_id ORDER BY v.name"
            ),
            audit: this.auditRows()
        }
    }
    revokeSessions(actor: CompanyUser, userId = actor.id) {
        if (userId !== actor.id) this.admin(actor)
        this.transaction(() => {
            if (!this.run("UPDATE company_users SET revoked_at=? WHERE id=?", Date.now(), userId).changes)
                throw new CompanyError(404, "User not found.")
            this.audit(actor, "sessions.revoked", userId)
        })
    }
    setDisabled(actor: CompanyUser, userId: string, disabled: unknown) {
        this.admin(actor)
        if (typeof disabled !== "boolean" || userId === actor.id)
            throw new CompanyError(400, "You cannot disable your own account.")
        this.transaction(() => {
            if (
                !this.run(
                    "UPDATE company_users SET disabled=?,revoked_at=? WHERE id=?",
                    disabled ? 1 : 0,
                    Date.now(),
                    userId
                ).changes
            )
                throw new CompanyError(404, "User not found.")
            this.audit(actor, disabled ? "user.disabled" : "user.enabled", userId)
        })
    }
    recoverVault(actor: CompanyUser, vaultId: string) {
        this.admin(actor)
        this.transaction(() => {
            const vault = this.one("SELECT name FROM company_vaults WHERE id=?", vaultId)
            if (!vault) throw new CompanyError(404, "Vault not found or access was removed.")
            const existing = this.one(
                "SELECT id,role FROM company_members WHERE vault_id=? AND user_id=?",
                vaultId,
                actor.id
            )
            if (existing && ["owner", "admin"].includes(existing.role)) return
            if (existing) this.run("UPDATE company_members SET role='admin' WHERE id=?", existing.id)
            else
                this.run(
                    "INSERT INTO company_members(id,vault_id,user_id,invited_email,role,created_at) VALUES(?,?,?,?,?,?)",
                    randomUUID(),
                    vaultId,
                    actor.id,
                    actor.email,
                    "admin",
                    Date.now()
                )
            this.audit(actor, "vault.recovered", vault.name, vaultId)
        })
    }
    importLocal(actor: CompanyUser, input: any) {
        const sourceId = text(input?.sourceId, 256, true)
        if (!Array.isArray(input?.vaults) || !input.vaults.length || input.vaults.length > 200)
            throw new CompanyError(400, "Invalid local import.")
        const vaults = input.vaults.map((vault: any) => {
            if (!Array.isArray(vault.items) || vault.items.length > 5000)
                throw new CompanyError(400, "Invalid local import.")
            return {
                name: text(vault.name, 160, true).trim(),
                items: vault.items.map(itemContent)
            }
        })
        return this.transaction(() => {
            const previous = this.one(
                "SELECT result FROM company_imports WHERE user_id=? AND source_id=?",
                actor.id,
                sourceId
            )
            if (previous)
                return {
                    vaultIds: JSON.parse(previous.result) as string[],
                    alreadyImported: true
                }
            const ids: string[] = []
            for (const vault of vaults) {
                const created = this.insertVault(actor, vault.name),
                    row = this.member(actor, created.id),
                    key = this.key(row)
                ids.push(created.id)
                for (const item of vault.items) {
                    const id = randomUUID()
                    this.run(
                        "INSERT INTO company_items(id,vault_id,payload,version,updated_at) VALUES(?,?,?,?,?)",
                        id,
                        created.id,
                        JSON.stringify(encrypt(key, JSON.stringify(item), `vault-item:${created.id}:${id}:1`)),
                        1,
                        Date.now()
                    )
                }
                this.audit(actor, "vault.imported", created.name, created.id)
            }
            this.run(
                "INSERT INTO company_imports(user_id,source_id,result) VALUES(?,?,?)",
                actor.id,
                sourceId,
                JSON.stringify(ids)
            )
            return { vaultIds: ids, alreadyImported: false }
        })
    }
    rotateWrappingKeys() {
        this.transaction(() => {
            for (const row of this.all("SELECT * FROM company_vaults"))
                this.run(
                    "UPDATE company_vaults SET wrapped_key=? WHERE id=?",
                    wrapKey(
                        this.key(row),
                        row.id,
                        this.settings.activeKey,
                        this.settings.keys[this.settings.activeKey]
                    ),
                    row.id
                )
            this.run(
                "INSERT INTO company_audit(actor_id,actor_email,action,target,created_at) VALUES(?,?,?,?,?)",
                "local-operator",
                "local-operator",
                "keys.rotated",
                this.settings.activeKey,
                Date.now()
            )
        })
    }
    backup(destination: string) {
        if (!isAbsolute(destination) || existsSync(destination)) throw new Error("Choose a new absolute backup path")
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
        this.db.prepare("VACUUM INTO ?").run(destination)
        if (process.platform !== "win32") chmodSync(destination, 0o600)
    }
}

let cached: CompanyStore | undefined
let cachedSettings = ""
export function getCompanyStore(): CompanyStore {
    const settings = readCompanySettings(),
        fingerprint = JSON.stringify({
            ...settings,
            keys: Object.fromEntries(
                Object.entries(settings.keys).map(([key, value]) => [key, value.toString("base64")])
            )
        })
    if (!cached || cachedSettings !== fingerprint) {
        cached?.close()
        cached = new CompanyStore(settings)
        cachedSettings = fingerprint
    }
    return cached
}
