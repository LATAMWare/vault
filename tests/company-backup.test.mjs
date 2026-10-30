import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser, fixtureAccount } from './browser.mjs'

setupBrowser()
const { encryptCompanyBackup, decryptCompanyBackup } = await import('../src/logic/company-backup.ts')
const { prepareLocalBackup } = await import('../src/logic/company-migration.ts')
const { encodeData } = await import('../src/logic/utils.ts')
const { getServicePassword } = await import('../src/logic/service.ts')
const item = { kind: 'password', title: 'Synthetic hosting', username: 'private-user', password: 'secret-fixture-only-123', url: 'https://example.test', notes: 'Private note' }
const backup = { format: 'latamware-company-backup', version: 1, sourceId: 'fixture-export-id', exportedAt: new Date().toISOString(), vaults: [{ name: 'Infrastructure', items: [item] }] }

test('portable company backups encrypt all content and restore only data and supported preferences', async () => {
    const password = 'synthetic-backup-password-only!'
    const exported = await encryptCompanyBackup({ ...backup, sessions: 'never-export-oauth' }, password, 'es')
    for (const value of [item.password, item.username, item.notes, item.title, 'never-export-oauth']) assert.equal(exported.includes(value), false)
    const restored = await decryptCompanyBackup(exported, password)
    assert.deepEqual(restored.vaults, backup.vaults)
    assert.deepEqual(restored.preferences, { language: 'es' })
    assert.equal(restored.sourceId, backup.sourceId)
    assert.equal('sessions' in restored, false)
    await assert.rejects(encryptCompanyBackup(backup, 'short', 'es'))
    await assert.rejects(decryptCompanyBackup(exported, 'wrong-password'))
    const tampered = JSON.parse(exported)
    tampered.payload = tampered.payload.slice(0, 60) + (tampered.payload[60] === 'A' ? 'B' : 'A') + tampered.payload.slice(61)
    await assert.rejects(decryptCompanyBackup(JSON.stringify(tampered), password))
    await assert.rejects(decryptCompanyBackup(JSON.stringify({ ...tampered, version: 2 }), password))
})

test('encrypted local .vault files import directly without overwriting local storage or trusting verifier/session metadata', async () => {
    const password = 'synthetic-previous-password!'
    const account = fixtureAccount()
    account.services.push({ id: 'service', vault: 'v', name: 'Old service', icon: 'key', description: '', url: 'https://example.test', identifier: 'legacy', alphabet: 'a', length: 18, version: 1 })
    account.secrets.push({ id: 'note', vault: 'v', name: 'Note', icon: 'key', description: '', content: await encodeData(password, 'Original private note') })
    account.drive = { token: 'synthetic-oauth-do-not-import' }
    account.master = { verifier: 'untrusted' }
    window.localStorage.setItem('sentinel', 'preserved')
    const file = await encodeData(password, JSON.stringify(account))
    const migrated = await prepareLocalBackup(file, password)
    assert.equal(migrated.vaults[0].items.find(item => item.kind === 'password').password, await getServicePassword(password, account.services[0], account.alphabets[0]))
    assert.equal(migrated.vaults[0].items.find(item => item.kind === 'note').notes, 'Original private note')
    assert.equal((await prepareLocalBackup(file, password)).sourceId, migrated.sourceId)
    for (const value of [password, 'synthetic-oauth-do-not-import', 'untrusted']) assert.equal(JSON.stringify(migrated).includes(value), false)
    await assert.rejects(prepareLocalBackup(file, 'wrong-password'))
    assert.equal(window.localStorage.getItem('sentinel'), 'preserved')
    assert.equal(window.localStorage.length, 1)
    window.localStorage.clear()
})
