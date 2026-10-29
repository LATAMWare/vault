import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser, fixtureAccount } from './browser.mjs'

setupBrowser()
const { getStorage, setStorage } = await import('../src/logic/storage.ts')
const { setAccountMasterPassword } = await import('../src/logic/account.ts')
const { encodeData } = await import('../src/logic/utils.ts')
const { getServicePassword } = await import('../src/logic/service.ts')
const { prepareLocalMigration } = await import('../src/logic/company-migration.ts')

test('migration materializes old generated passwords, decrypts notes and never sends a master password or OAuth metadata', async () => {
    const password = 'synthetic-old-master-password-only!'
    const account = fixtureAccount()
    account.secrets.push({ id: 'secret', vault: 'v', name: 'Note', icon: 'key', description: '', content: await encodeData(password, 'Original note ñ') })
    account.services.push({ id: 'service', vault: 'v', name: 'Legacy generated', icon: 'key', description: '', url: 'https://example.test', identifier: 'legacy', alphabet: 'a', length: 18, version: 1 })
    account.drive = { accessToken: 'synthetic-oauth-token' }
    setStorage('legacy-source', account)
    await setAccountMasterPassword({ accountId: 'legacy-source', masterPassword: password })
    const before = JSON.stringify(getStorage('legacy-source'))
    const expected = await getServicePassword(password, account.services[0], account.alphabets[0])
    const data = await prepareLocalMigration('legacy-source', password)
    assert.equal(data.vaults[0].items.find(item => item.kind === 'password').password, expected)
    assert.equal(data.vaults[0].items.find(item => item.kind === 'note').notes, 'Original note ñ')
    const serialized = JSON.stringify(data)
    for (const excluded of [password, 'synthetic-oauth-token', 'verifier', 'salt', 'masterPassword']) assert.equal(serialized.includes(excluded), false)
    assert.equal(JSON.stringify(getStorage('legacy-source')), before)
    await assert.rejects(prepareLocalMigration('legacy-source', 'wrong-password'))
    assert.equal(JSON.stringify(getStorage('legacy-source')), before)
})

test('a corrupt legacy item stops the complete migration without replacing source data', async () => {
    const account = fixtureAccount()
    account.secrets.push({ id: 'broken', vault: 'v', name: 'Broken', icon: 'key', description: '', content: 'vault:v2:broken' })
    setStorage('broken-source', account)
    const before = JSON.stringify(getStorage('broken-source'))
    await assert.rejects(prepareLocalMigration('broken-source', 'any-password'))
    assert.equal(JSON.stringify(getStorage('broken-source')), before)
})
