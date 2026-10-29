import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser, fixtureAccount } from './browser.mjs'
setupBrowser()
const { resetAllData } = await import('../src/logic/data.ts')
const { getStorage, setStorage } = await import('../src/logic/storage.ts')
const { getGoogleDriveState, setGoogleDriveState, pullGoogleDriveToAccount, buildDriveFileName } = await import('../src/logic/google.ts')
const { encodeData } = await import('../src/logic/utils.ts')

test('reset clears both session and legacy Drive credentials', async () => {
    setStorage('reset', { ...fixtureAccount(), drive: { connected: true, accessToken: 'legacy-token' } })
    setGoogleDriveState('reset', { connected: true, accessToken: 'session-token', expiresAt: Date.now() + 60000 })
    const handler = event => {
        if (event.data?.source === 'vault-extension-command') window.dispatchEvent(new window.MessageEvent('message', {
            source: window, origin: window.location.origin,
            data: { source: 'vault-extension-response', requestId: event.data.requestId, success: true }
        }))
    }
    window.addEventListener('message', handler)
    await resetAllData('reset')
    window.removeEventListener('message', handler)
    assert.equal(getStorage('reset').drive, undefined)
    assert.equal(getGoogleDriveState('reset').connected, false)
    assert.equal(getGoogleDriveState('reset').accessToken, '')
    assert.deepEqual(getStorage('reset').secrets, [])
})

test('Drive follows pagination and validates downloaded data before replacement', async () => {
    const account = fixtureAccount(); account.settings.push({ id: 'google-drive-file-id', value: 'fixture' })
    setStorage('drive', account)
    setGoogleDriveState('drive', { connected: true, accessToken: 'test-token', expiresAt: Date.now() + 60000 })
    const valid = await encodeData('fixture-password', JSON.stringify(account))
    const calls = [], originalFetch = globalThis.fetch
    globalThis.fetch = async url => {
        calls.push(String(url))
        if (String(url).includes('alt=media')) return new Response(valid)
        const query = new URL(url).searchParams
        if (!query.has('pageToken')) return Response.json({ files: [], nextPageToken: 'second' })
        assert.equal(query.get('pageToken'), 'second')
        return Response.json({ files: [{ id: 'remote', name: buildDriveFileName('drive') }] })
    }
    try {
        assert.equal(await pullGoogleDriveToAccount({ accountId: 'drive', masterPassword: 'fixture-password' }), true)
        assert.equal(calls.length, 3)
        const before = JSON.stringify(getStorage('drive'))
        globalThis.fetch = async url => String(url).includes('alt=media')
            ? new Response(await encodeData('fixture-password', '{"invalid":true}'))
            : Response.json({ files: [{ id: 'bad', name: buildDriveFileName('drive') }] })
        assert.equal(await pullGoogleDriveToAccount({ accountId: 'drive', masterPassword: 'fixture-password' }), false)
        assert.equal(JSON.stringify(getStorage('drive')), before)
    } finally { globalThis.fetch = originalFetch }
})
