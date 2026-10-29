import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { CompanyStore, CompanyError, readCompanySettings } from '../src/server/company-store.ts'
import { parseAccessPolicy } from '../src/server/access-policy.ts'

const policy = parseAccessPolicy('latamware.test', 'alice@gmail.com,bob@gmail.com')
const content = (password = 'synthetic-password-only-123!') => ({ kind: 'password', title: 'Hosting', username: 'synthetic-user', password, url: 'https://example.test', notes: 'synthetic private note' })
const denied = (fn, status) => assert.throws(fn, error => error instanceof CompanyError && error.status === status)
function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'latamware-company-test-'))
    const settings = { path: join(root, 'company.sqlite'), keys: { v1: randomBytes(32) }, activeKey: 'v1', admins: ['admin@latamware.test'] }
    let store = new CompanyStore(settings)
    t.after(() => {
        try { store.close() } catch {}
        assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()))
        assert.ok(root.split(/[\\/]/).at(-1).startsWith('latamware-company-test-'))
        rmSync(root, { recursive: true, force: true })
    })
    const authenticatedAt = Date.now() - 2000
    const admin = store.authenticate({ id: 'admin-sub', email: 'admin@latamware.test' }, authenticatedAt)
    const alice = store.authenticate({ id: 'alice-sub', email: 'alice@gmail.com' }, authenticatedAt)
    const bob = store.authenticate({ id: 'bob-sub', email: 'bob@gmail.com' }, authenticatedAt)
    return { root, settings, admin, alice, bob, get store() { return store }, reopen(next = settings) { store.close(); store = new CompanyStore(next); return store } }
}

test('Google users get central encrypted vaults, pending invitations and server-enforced roles', t => {
    const f = fixture(t), { store, admin, alice, bob } = f
    assert.equal(store.listVaults(admin).length, 1)
    assert.equal(store.listVaults(alice).length, 0)
    assert.equal(alice.isAdmin, false)
    const vault = store.createVault(admin, 'Infrastructure')
    const saved = store.saveItem(admin, vault.id, content())
    denied(() => store.getVault(alice, vault.id), 404)
    store.share(admin, vault.id, alice.email, 'reader', policy)
    assert.equal(store.getVault(alice, vault.id).items[0].password, content().password)
    denied(() => store.saveItem(alice, vault.id, content()), 403)
    denied(() => store.share(alice, vault.id, bob.email, 'admin', policy), 403)
    denied(() => store.adminData({ ...alice, isAdmin: true }), 403)
    store.share(admin, vault.id, 'future@latamware.test', 'editor', policy)
    assert.ok(store.listMembers(admin, vault.id).some(member => member.email === 'future@latamware.test' && member.pending))
    const future = store.authenticate({ id: 'future-sub', email: 'future@latamware.test' }, Date.now())
    assert.equal(store.getVault(future, vault.id).role, 'editor')
    const raw = JSON.stringify(store.db.prepare('SELECT * FROM company_items').all())
    for (const value of [content().password, content().notes, content().username]) assert.equal(raw.includes(value), false)
    assert.equal(JSON.stringify(store.adminData(admin).audit).includes(content().password), false)
    assert.equal(f.reopen().getVault(alice, vault.id).items[0].id, saved.id)
})

test('concurrent edits reject stale versions, item IDs cannot cross vaults and owners cannot be demoted', t => {
    const { store, admin, alice } = fixture(t)
    const first = store.createVault(admin, 'First'), other = store.createVault(admin, 'Other')
    store.share(admin, first.id, alice.email, 'editor', policy)
    const saved = store.saveItem(admin, first.id, content())
    store.saveItem(alice, first.id, content('updated'), saved.id, 1)
    denied(() => store.saveItem(admin, first.id, content('stale'), saved.id, 1), 409)
    assert.equal(store.getVault(admin, first.id).items[0].password, 'updated')
    denied(() => store.saveItem(admin, other.id, content('stolen'), saved.id, 2), 404)
    denied(() => store.deleteItem(admin, other.id, saved.id, 2), 404)
    denied(() => store.renameVault(alice, first.id, 'unauthorized', 1), 403)
    denied(() => store.deleteVault(alice, first.id, 1), 403)
    const owner = store.listMembers(admin, first.id).find(member => member.role === 'owner')
    denied(() => store.removeMember(admin, first.id, owner.id), 400)
    denied(() => store.share(admin, first.id, admin.email, 'reader', policy), 400)
    denied(() => store.share(admin, first.id, 'unlisted@gmail.com', 'reader', policy), 400)
    denied(() => store.share(admin, first.id, 'not-an-email', 'reader', policy), 400)
    const reader = store.listMembers(admin, first.id).find(member => member.email === alice.email)
    store.removeMember(admin, first.id, reader.id)
    denied(() => store.getVault(alice, first.id), 404)
})

test('administrator recovery is explicit and audited; account disabling and revocation block existing sessions', t => {
    const { store, admin, alice, bob } = fixture(t)
    const vault = store.createVault(alice, 'Alice private')
    store.saveItem(alice, vault.id, content())
    denied(() => store.getVault(admin, vault.id), 404)
    denied(() => store.recoverVault(bob, vault.id), 403)
    store.share(alice, vault.id, admin.email, 'reader', policy)
    store.recoverVault(admin, vault.id)
    assert.equal(store.getVault(admin, vault.id).role, 'admin')
    assert.ok(store.getAudit(admin, vault.id).some(event => event.action === 'vault.recovered'))
    store.setDisabled(admin, alice.id, true)
    denied(() => store.authenticate(alice, Date.now() + 1000), 403)
    store.setDisabled(admin, alice.id, false)
    denied(() => store.authenticate(alice, Date.now() - 1000), 401)
    assert.equal(store.authenticate(alice, Date.now() + 1000).id, alice.id)
    store.revokeSessions(bob)
    denied(() => store.authenticate(bob, Date.now() - 1000), 401)
    denied(() => store.revokeSessions(bob, admin.id), 403)
    denied(() => store.setDisabled(admin, admin.id, true), 400)
    const renamed = store.authenticate({ id: alice.id, email: 'renamed@latamware.test' }, Date.now() + 2000)
    assert.equal(store.getVault(renamed, vault.id).role, 'owner', 'memberships bind to Google subject')
    denied(() => store.authenticate({ id: 'impostor-sub', email: renamed.email }, Date.now() + 2000), 403)
})

test('envelopes reject tampering and moving ciphertext between items or vaults', t => {
    const { store, admin } = fixture(t)
    const vault = store.createVault(admin, 'Encrypted')
    const a = store.saveItem(admin, vault.id, content('first'))
    const b = store.saveItem(admin, vault.id, content('second'))
    const first = store.db.prepare('SELECT payload FROM company_items WHERE id=?').get(a.id).payload
    const second = store.db.prepare('SELECT payload FROM company_items WHERE id=?').get(b.id).payload
    store.db.prepare('UPDATE company_items SET payload=? WHERE id=?').run(first, b.id)
    assert.throws(() => store.getVault(admin, vault.id))
    store.db.prepare('UPDATE company_items SET payload=? WHERE id=?').run(second, b.id)
    const envelope = JSON.parse(first)
    const bytes = Buffer.from(envelope.data, 'base64'); bytes[0] ^= 1; envelope.data = bytes.toString('base64')
    store.db.prepare('UPDATE company_items SET payload=? WHERE id=?').run(JSON.stringify(envelope), a.id)
    assert.throws(() => store.getVault(admin, vault.id))
})

test('key rotation and a consistent database backup restore data without a user master password', t => {
    const f = fixture(t), vault = f.store.createVault(f.admin, 'Recovery')
    f.store.saveItem(f.admin, vault.id, content())
    const next = { ...f.settings, keys: { ...f.settings.keys, v2: randomBytes(32) }, activeKey: 'v2' }
    f.reopen(next).rotateWrappingKeys()
    const backup = join(f.root, 'backup.sqlite')
    f.store.backup(backup)
    const restored = new CompanyStore({ ...next, path: backup, keys: { v2: next.keys.v2 } })
    try { assert.equal(restored.getVault(f.admin, vault.id).items[0].password, content().password) } finally { restored.close() }
    const envFile = join(f.root, 'empty.env'), commandBackup = join(f.root, 'command-backup.sqlite')
    writeFileSync(envFile, '')
    execFileSync(process.execPath, ['scripts/company-backup.mjs', commandBackup], { windowsHide: true, env: { ...process.env, VAULT_ENV_FILE: envFile, VAULT_DATABASE_PATH: next.path }, stdio: 'pipe' })
    const commandRestored = new CompanyStore({ ...next, path: commandBackup })
    try { assert.equal(commandRestored.getVault(f.admin, vault.id).items[0].password, content().password) } finally { commandRestored.close() }
    assert.throws(() => new CompanyStore({ ...next, keys: { v2: randomBytes(32) } }))
    assert.equal(f.store.getVault(f.admin, vault.id).items[0].password, content().password)
    assert.throws(() => f.store.backup(backup))
})

test('local import is atomic, private to its importer and idempotent across retries', t => {
    const { store, admin, alice } = fixture(t)
    const data = { sourceId: 'legacy-profile', vaults: [{ name: 'Imported', items: [content()] }] }
    const result = store.importLocal(alice, data)
    assert.equal(result.alreadyImported, false)
    assert.equal(store.importLocal(alice, data).alreadyImported, true)
    assert.equal(store.getVault(alice, result.vaultIds[0]).items[0].password, content().password)
    denied(() => store.getVault(admin, result.vaultIds[0]), 404)
    const before = store.listVaults(alice).length
    denied(() => store.importLocal(alice, { sourceId: 'invalid', vaults: [{ name: 'Valid', items: [content()] }, { name: 'Invalid', items: [{ kind: 'note', title: 'Empty', notes: '' }] }] }), 400)
    assert.equal(store.listVaults(alice).length, before)
})

test('company settings require persistent absolute storage, separate valid keys and explicit administrators', () => {
    assert.throws(() => readCompanySettings({}))
    assert.throws(() => readCompanySettings({ VAULT_DATABASE_PATH: 'relative.sqlite' }))
    const base = { VAULT_DATABASE_PATH: join(tmpdir(), 'unused.sqlite'), VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }), VAULT_ADMIN_EMAILS: 'admin@latamware.test' }
    assert.equal(readCompanySettings(base).admins[0], 'admin@latamware.test')
    assert.throws(() => readCompanySettings({ ...base, VAULT_ADMIN_EMAILS: '' }))
    assert.throws(() => readCompanySettings({ ...base, VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: 'short' }) }))
    assert.throws(() => readCompanySettings({ ...base, VAULT_ACTIVE_KEY_ID: 'missing' }))
})
