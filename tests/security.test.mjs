import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser, fixtureAccount } from './browser.mjs'
setupBrowser()
const { encodeData, decodeData, bufToBase64, base64ToBuf, genServicePassword } = await import('../src/logic/utils.ts')
const { getStorage, setStorage } = await import('../src/logic/storage.ts')
const { setAccountMasterPassword, changeMasterPassword, checkAccountMasterPassword, restoreAccountData } = await import('../src/logic/account.ts')
const { createSecret } = await import('../src/logic/secret.ts')
const { createService, getServicePassword, updateService } = await import('../src/logic/service.ts')
const { deleteAlphabet, updateAlphabet } = await import('../src/logic/alphabet.ts')
const { showAlert } = await import('../src/logic/alert.ts')
const { updateSettings } = await import('../src/logic/settings.ts')
const password = ' Fixture password with spaces '

const legacyEncrypt = async (key, plaintext) => {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(16))
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveKey'])
    const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, material, { name: 'AES-CBC', length: 256 }, false, ['encrypt'])
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aes, new TextEncoder().encode(plaintext)))
    const bytes = new Uint8Array(32 + ciphertext.length); bytes.set(salt); bytes.set(iv, 16); bytes.set(ciphertext, 32)
    return bufToBase64(bytes.buffer)
}

test('GCM supports large Unicode backups and rejects tampering, wrong passwords and unknown formats', async () => {
    const content = 'ñ 🔒\n'.repeat(100000)
    const encrypted = await encodeData(password, content)
    assert.equal(await decodeData(password, encrypted), content)
    assert.ok(encrypted.startsWith('vault:v2:'))
    const bytes = new Uint8Array(base64ToBuf(encrypted.slice(9))); bytes[16] ^= 1
    await assert.rejects(decodeData(password, 'vault:v2:' + bufToBase64(bytes.buffer)))
    await assert.rejects(decodeData('wrong', encrypted))
    await assert.rejects(decodeData(password, encrypted.replace('v2:', 'v3:')))
    assert.equal(await decodeData(password, await legacyEncrypt(password, 'legacy fixture')), 'legacy fixture')
})

test('derivation preserves legacy outputs and separates algorithm from service rotation', async () => {
    const alphabet = fixtureAccount().alphabets[0]
    const legacy = await genServicePassword(password, 'fixture', 18, alphabet, 1)
    // Golden vector compared against the unmodified generator at commit 7e4223d.
    assert.equal(legacy, 'HLhOcKPdeQIpPWw0tv')
    assert.equal(legacy, await genServicePassword(password, 'fixture', 18, alphabet, 1, 'legacy'))
    const modern = await genServicePassword(password, 'fixture', 18, alphabet, 1, 'pbkdf2-v2')
    assert.equal(modern, 'FJ0bzL93EOWYbDYmO4')
    assert.equal(modern, await genServicePassword(password, 'fixture', 18, alphabet, 1, 'pbkdf2-v2'))
    assert.notEqual(modern, legacy)
    assert.notEqual(modern, await genServicePassword(password, 'fixture', 18, alphabet, 2, 'pbkdf2-v2'))
    await assert.rejects(genServicePassword(password, 'fixture', -1, alphabet))
})

test('master rotation preserves passwords, reencrypts every field, and is atomic', async () => {
    const account = fixtureAccount()
    account.services.push({ id: 'legacy', name: 'Legacy', icon: 'key', description: await legacyEncrypt(password, 'legacy description'), url: '', identifier: 'legacy', alphabet: 'a', length: 18, vault: 'v', version: 1 })
    account.secrets.push({ id: 'legacy-secret', name: 'Secret', icon: 'key', content: await legacyEncrypt(password, '  sensitive content  '), description: '', vault: 'v' })
    setStorage('rotation', account)
    await setAccountMasterPassword({ accountId: 'rotation', masterPassword: password })
    const newId = await createService({ accountId: 'rotation', vaultId: 'v', name: 'New', description: 'description', url: '', icon: 'key', identifier: 'new', alphabet: 'a', length: 18, masterPassword: password })
    const originals = await Promise.all(getStorage('rotation').services.map(s => getServicePassword(password, s, account.alphabets[0])))
    const nextPassword = 'new master fixture'
    assert.equal(await changeMasterPassword({ accountId: 'rotation', currentMasterPassword: password, newMasterPassword: nextPassword }), true)
    assert.equal(await checkAccountMasterPassword({ accountId: 'rotation', masterPassword: password }), false)
    assert.equal(await checkAccountMasterPassword({ accountId: 'rotation', masterPassword: nextPassword }), true)
    const rotated = getStorage('rotation')
    assert.equal(await decodeData(nextPassword, rotated.secrets[0].content), '  sensitive content  ')
    assert.equal(await decodeData(nextPassword, rotated.services[0].description), 'legacy description')
    assert.deepEqual(await Promise.all(rotated.services.map(s => getServicePassword(nextPassword, s, rotated.alphabets[0]))), originals)
    assert.equal(rotated.session.revokePrevious, true)
    const before = JSON.stringify(rotated)
    assert.equal(await changeMasterPassword({ accountId: 'rotation', currentMasterPassword: 'wrong', newMasterPassword: 'another' }), false)
    assert.equal(JSON.stringify(getStorage('rotation')), before)
    await assert.rejects(createSecret({ accountId: 'rotation', name: 'stale', content: 'must not persist', description: '', icon: 'key', vault: 'v', masterPassword: password }))
    assert.equal(JSON.stringify(getStorage('rotation')), before)
    const service = rotated.services.find(s => s.id === newId)
    await updateService({ ...service, accountId: 'rotation', serviceId: newId, vaultId: 'v', description: '', name: 'Renamed', masterPassword: nextPassword })
    assert.equal(await getServicePassword(nextPassword, getStorage('rotation').services.find(s => s.id === newId), rotated.alphabets[0]), originals[1])
    await updateService({ ...service, version: 2, accountId: 'rotation', serviceId: newId, vaultId: 'v', description: '', masterPassword: nextPassword })
    const explicitlyRotated = getStorage('rotation').services.find(s => s.id === newId)
    assert.equal(explicitlyRotated.password, undefined)
    assert.equal(explicitlyRotated.algorithm, 'pbkdf2-v2')
    assert.notEqual(await getServicePassword(nextPassword, explicitlyRotated, rotated.alphabets[0]), originals[1])
    const bad = getStorage('rotation'); bad.secrets[0].content = 'corrupt'; setStorage('rotation', bad)
    const corruptBefore = JSON.stringify(getStorage('rotation'))
    assert.equal(await changeMasterPassword({ accountId: 'rotation', currentMasterPassword: nextPassword, newMasterPassword: 'third master' }), false)
    assert.equal(JSON.stringify(getStorage('rotation')), corruptBefore)
})

test('import validates the complete graph before committing and migrates legacy encryption', async () => {
    const account = fixtureAccount(); setStorage('import', account)
    const before = JSON.stringify(getStorage('import'))
    for (const invalid of [{ unexpected: true }, { ...account, secrets: [{ id: 'bad' }] }, { ...account, services: [{ id: 'bad', alphabet: 'missing' }] }]) {
        await assert.rejects(restoreAccountData('import', password, await encodeData(password, JSON.stringify(invalid))))
        assert.equal(JSON.stringify(getStorage('import')), before)
    }
    account.secrets.push({ id: 's', name: 'Secret', icon: 'key', content: await legacyEncrypt(password, 'legacy'), description: '', vault: 'v' })
    account.drive = { accessToken: 'must-not-import' }
    await restoreAccountData('import', password, await legacyEncrypt(password, JSON.stringify(account)))
    const imported = getStorage('import')
    assert.ok(imported.secrets[0].content.startsWith('vault:v2:'))
    assert.equal(await decodeData(password, imported.secrets[0].content), 'legacy')
    assert.equal(imported.drive, undefined)
})

test('concurrent saves retain every item and stale writes cannot undo a synchronous delete', async () => {
    setStorage('parallel', fixtureAccount())
    const input = { accountId: 'parallel', name: 'Fixture', content: '  unchanged  ', description: '', icon: 'key', vault: 'v', masterPassword: password }
    await Promise.all([createSecret(input), createSecret(input)])
    assert.equal(getStorage('parallel').secrets.length, 2)
    assert.equal(await decodeData(password, getStorage('parallel').secrets[0].content), input.content)
    const service = { ...input, vaultId: 'v', identifier: 'fixture', alphabet: 'a', length: 14, url: '' }
    await Promise.all([createService(service), createService(service)])
    assert.equal(getStorage('parallel').services.length, 2)
    const saving = createSecret(input)
    await new Promise(resolve => setTimeout(resolve, 10))
    const changed = getStorage('parallel'); changed.vaults = []; setStorage('parallel', changed)
    await assert.rejects(saving)
    assert.deepEqual(getStorage('parallel').vaults, [])
})

test('used alphabets cannot be deleted or change derivation inputs', () => {
    const account = fixtureAccount(); account.services = [{ id: 's', alphabet: 'a' }]; setStorage('alphabets', account)
    assert.throws(() => deleteAlphabet('alphabets', 'a'), /used/)
    assert.throws(() => updateAlphabet({ ...account.alphabets[0], accountId: 'alphabets', alphabetId: 'a', characters: 'changed' }), /in use/)
    assert.equal(getStorage('alphabets').alphabets[0].characters, account.alphabets[0].characters)
})

test('invalid settings cannot create accounts that fail their own backup validation', () => {
    setStorage('settings', fixtureAccount())
    const before = JSON.stringify(getStorage('settings'))
    for (const value of [NaN, 0, -1, 1.5, 1025]) assert.equal(updateSettings({ accountId: 'settings', settingId: 'default-password-length', value }), false)
    assert.equal(JSON.stringify(getStorage('settings')), before)
})

test('untrusted alert content is text rather than executable HTML', () => {
    const payload = '<img src=x onerror="document.title=\'executed\'">'
    showAlert(payload, 'success', 'check', 1)
    assert.equal(document.querySelectorAll('.alert img').length, 0)
    assert.ok(document.querySelector('.alert:last-child').textContent.includes(payload))
})
