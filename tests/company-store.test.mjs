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

test('pins are personal, persistent and available to readers without changing shared item versions', t => {
    const f = fixture(t), { store, admin, alice, bob } = f
    const vault = store.createVault(admin, 'Personal pins')
    const first = store.saveItem(admin, vault.id, content())
    const second = store.saveItem(admin, vault.id, { ...content(), title: 'Another item' })
    store.share(admin, vault.id, alice.email, 'reader', policy)
    store.setPinned(alice, vault.id, first.id, true)
    const pinned = store.getVault(alice, vault.id).items
    assert.equal(pinned[0].id, first.id)
    assert.equal(pinned[0].pinned, true)
    assert.equal(pinned[0].version, 1)
    assert.equal(store.getVault(admin, vault.id).items.every(item => !item.pinned), true)
    denied(() => store.setPinned(bob, vault.id, first.id, true), 404)
    denied(() => store.setPinned(alice, vault.id, second.id, 'yes'), 400)
    const other = store.createVault(admin, 'Other')
    denied(() => store.setPinned(admin, other.id, first.id, true), 404)
    assert.equal(f.reopen().getVault(alice, vault.id).items.find(item => item.id === first.id).pinned, true)
    f.store.setPinned(alice, vault.id, first.id, false)
    assert.equal(f.store.getVault(alice, vault.id).items.every(item => !item.pinned), true)
    f.store.setPinned(alice, vault.id, first.id, true)
    f.store.deleteItem(admin, vault.id, first.id, 1)
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM company_pins').get().n, 0)
})

test('copy requests and edits identify the actor and item without storing credential values in activity', t => {
    const { store, admin, alice, bob } = fixture(t)
    const vault = store.createVault(admin, 'Audit copies')
    const item = store.saveItem(admin, vault.id, content())
    store.share(admin, vault.id, alice.email, 'reader', policy)
    assert.equal(store.copyItem(alice, vault.id, item.id, 'username').value, content().username)
    assert.equal(store.copyItem(alice, vault.id, item.id, 'password').value, content().password)
    denied(() => store.copyItem(bob, vault.id, item.id, 'password'), 404)
    denied(() => store.copyItem(alice, vault.id, item.id, 'title'), 400)
    denied(() => store.copyItem(alice, vault.id, item.id, ['password']), 400)
    const events = store.getAudit(admin, vault.id)
    const copies = events.filter(entry => entry.action.endsWith('_copy_requested'))
    assert.equal(copies.length, 2)
    assert.ok(copies.every(entry => entry.actor === alice.email && entry.target === content().title && entry.createdAt > 0))
    for (const value of [content().password, content().username, content().notes]) assert.equal(JSON.stringify(events).includes(value), false)
    store.saveItem(admin, vault.id, { ...content(), title: 'Renamed hosting' }, item.id, 1)
    assert.equal(store.getAudit(admin, vault.id).find(entry => entry.action === 'item.updated').target, 'Renamed hosting')
    const member = store.listMembers(admin, vault.id).find(member => member.email === alice.email)
    store.removeMember(admin, vault.id, member.id)
    denied(() => store.copyItem(alice, vault.id, item.id, 'password'), 404)
    denied(() => store.setPinned(alice, vault.id, item.id, true), 404)
})

test('exports only include explicitly selected accessible vaults and audit exports without restoring sharing', t => {
    const { store, admin, alice, bob } = fixture(t)
    const vault = store.createVault(admin, 'Exportable')
    store.saveItem(admin, vault.id, content())
    store.share(admin, vault.id, alice.email, 'reader', policy)
    const backup = store.exportData(alice, [vault.id])
    assert.equal(backup.format, 'latamware-company-backup')
    assert.deepEqual(backup.vaults, [{ name: 'Exportable', items: [content()] }])
    assert.equal(JSON.stringify(backup).includes('wrapped_key'), false)
    denied(() => store.exportData(bob, [vault.id]), 404)
    denied(() => store.exportData(alice, [vault.id, store.listVaults(admin).find(value => value.id !== vault.id).id]), 404)
    denied(() => store.exportData(alice, []), 400)
    const imported = store.importLocal(alice, backup)
    assert.equal(store.getVault(alice, imported.vaultIds[0]).role, 'owner')
    denied(() => store.getVault(admin, imported.vaultIds[0]), 404)
    assert.equal(store.importLocal(alice, backup).alreadyImported, true)
    assert.equal(store.getAudit(admin, vault.id).filter(entry => entry.action === 'vault.exported').length, 1)
})

test('routine authentication reads do not write but still check revocation and claim new invitations immediately', t => {
    const { store, admin, alice } = fixture(t)
    const before = store.db.prepare('SELECT total_changes() n').get().n
    store.authenticate({ id: alice.id, email: alice.email }, Date.now())
    assert.equal(store.db.prepare('SELECT total_changes() n').get().n, before)
    const vault = store.createVault(admin, 'Pending invitation')
    store.share(admin, vault.id, 'future@latamware.test', 'reader', policy)
    const future = store.authenticate({ id: 'new-future-sub', email: 'future@latamware.test' }, Date.now())
    assert.equal(store.listVaults(future)[0].id, vault.id)
    const oldLogin = Date.now() - 1000
    store.revokeSessions(admin, alice.id)
    denied(() => store.authenticate({ id: alice.id, email: alice.email }, oldLogin), 401)
})

test('existing schema v1 databases upgrade in place without changing encrypted items or memberships', t => {
    const f = fixture(t), { store, admin, alice } = f
    const vault = store.createVault(admin, 'Before upgrade')
    const saved = store.saveItem(admin, vault.id, content())
    store.share(admin, vault.id, alice.email, 'reader', policy)
    const payload = store.db.prepare('SELECT payload FROM company_items WHERE id=?').get(saved.id).payload
    store.db.exec('DROP TABLE company_pins; PRAGMA user_version=1;')
    const upgraded = f.reopen()
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 2)
    assert.equal(upgraded.db.prepare('SELECT payload FROM company_items WHERE id=?').get(saved.id).payload, payload)
    assert.equal(upgraded.getVault(alice, vault.id).items[0].password, content().password)
    assert.equal(upgraded.getVault(alice, vault.id).items[0].pinned, false)
    upgraded.setPinned(alice, vault.id, saved.id, true)
    assert.equal(upgraded.getVault(alice, vault.id).items[0].pinned, true)
})

test('vault activity preserves names and resolves historical UUID targets for both vault and global activity', t => {
    const { store, admin } = fixture(t)
    const vault = store.createVault(admin, 'Named vault')
    const created = store.getAudit(admin, vault.id).find(entry => entry.action === 'vault.created')
    assert.equal(created.target, 'Named vault')
    store.renameVault(admin, vault.id, 'Renamed vault', vault.version)
    assert.equal(store.getAudit(admin, vault.id).find(entry => entry.action === 'vault.created').target, 'Named vault')
    // Simulate a pre-upgrade audit row without rewriting the historical database record.
    store.db.prepare('UPDATE company_audit SET target=? WHERE id=?').run(vault.id, created.id)
    assert.equal(store.getAudit(admin, vault.id).find(entry => entry.id === created.id).target, 'Renamed vault')
    assert.equal(store.adminData(admin).audit.find(entry => entry.id === created.id).target, 'Renamed vault')
    const current = store.getVault(admin, vault.id)
    store.deleteVault(admin, vault.id, current.version)
    assert.equal(store.adminData(admin).audit.find(entry => entry.action === 'vault.deleted' && entry.target === 'Renamed vault').target, 'Renamed vault')
})

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
