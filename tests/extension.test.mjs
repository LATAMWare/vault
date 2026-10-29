import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser, fixtureAccount } from './browser.mjs'
setupBrowser()
const { setStorage } = await import('../src/logic/storage.ts')
const { sendChromeExtensionCommand, syncServicesWithChromeExtension } = await import('../src/logic/service.ts')

test('extension responses must match window, origin, request and capabilities', async () => {
    const original = window.postMessage
    window.postMessage = detail => {
        const response = { source: 'vault-extension-response', requestId: detail.requestId, success: true, capabilities: ['pbkdf2-v2'] }
        window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: 'https://untrusted.test', data: response }))
        setTimeout(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin, data: { ...response, success: false } })), 5)
    }
    try {
        assert.equal(await sendChromeExtensionCommand({ type: 'GET_CAPABILITIES', requiredCapabilities: ['pbkdf2-v2'] }), false)
        window.postMessage = detail => setTimeout(() => window.dispatchEvent(new window.MessageEvent('message', {
            source: window, origin: window.location.origin,
            data: { source: 'vault-extension-response', requestId: detail.requestId, success: true, capabilities: ['pbkdf2-v2'] }
        })), 0)
        assert.equal(await sendChromeExtensionCommand({ type: 'GET_CAPABILITIES', requiredCapabilities: ['pbkdf2-v2'] }), true)
        assert.equal(await sendChromeExtensionCommand({ type: 'GET_CAPABILITIES', requiredCapabilities: ['encrypted-service-passwords'] }), false)
    } finally { window.postMessage = original }
})

test('incompatible extensions never receive current-format account data', async () => {
    const account = fixtureAccount()
    account.services.push({ id: 's', algorithm: 'pbkdf2-v2' })
    setStorage('extension', account)
    const original = window.postMessage, messages = []
    window.postMessage = detail => {
        messages.push(detail)
        if (detail.source === 'vault-extension-command') setTimeout(() => window.dispatchEvent(new window.MessageEvent('message', {
            source: window, origin: window.location.origin,
            data: { source: 'vault-extension-response', requestId: detail.requestId, success: true, capabilities: [] }
        })), 0)
    }
    try {
        assert.equal(await syncServicesWithChromeExtension({ accountId: 'extension' }), false)
        assert.equal(messages.some(message => message.source === 'vault-extension-sync'), false)
    } finally { window.postMessage = original }
})
