import assert from 'node:assert/strict'
import test from 'node:test'
import { companyApi, CompanyApiError } from '../src/logic/company-client.ts'

test('interrupted connections report a localized message without retrying mutations, while cancellation stays silent', async () => {
    const original = globalThis.fetch
    let calls = 0
    try {
        globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch') }
        await assert.rejects(companyApi('/admin/audit/seals', 'POST'), error => {
            assert.ok(error instanceof CompanyApiError)
            assert.equal(error.status, 0)
            assert.ok(error.message.startsWith('Connection to Vault was interrupted.'))
            return true
        })
        assert.equal(calls, 1)
        const controller = new AbortController()
        controller.abort()
        const aborted = new DOMException('Cancelled', 'AbortError')
        globalThis.fetch = async () => { throw aborted }
        await assert.rejects(companyApi('', 'GET', undefined, controller.signal), error => error === aborted)
    } finally { globalThis.fetch = original }
})
