// Run after `pnpm build`. Exercises the actual standalone server without Google credentials.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { encode } from '@auth/core/jwt'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

async function freePort() {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    return port
}

async function withServer(configured, check) {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'latamware-company-http-'))
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const secret = 'synthetic-http-test-secret-0123456789-abcdef-987654321'
    const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
            ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
            VAULT_AUTH_MODE: 'google', VAULT_AUTH_ORIGIN: configured ? origin : '',
            AUTH_SECRET: secret, GOOGLE_AUTH_CLIENT_ID: 'synthetic-client', GOOGLE_AUTH_CLIENT_SECRET: 'synthetic-secret',
            VAULT_ALLOWED_DOMAINS: 'latamware.com,iguapp.tur.ar', VAULT_ALLOWED_EMAILS: 'dapris12@gmail.com,gorguesraul01@gmail.com',
            VAULT_DATABASE_PATH: join(dataDirectory, 'company.sqlite'), VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }),
            VAULT_ACTIVE_KEY_ID: 'v1', VAULT_ADMIN_EMAILS: 'admin@latamware.com'
        }
    })
    let logs = ''
    child.stdout.on('data', data => { logs = (logs + data).slice(-6000) })
    child.stderr.on('data', data => { logs = (logs + data).slice(-6000) })
    try {
        const deadline = Date.now() + 20000
        let ready = false
        while (Date.now() < deadline && child.exitCode === null) {
            try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }); ready = true; break } catch {}
            await delay(100)
        }
        assert.ok(ready, `Standalone server did not start: ${logs}`)
        await check({ origin, secret })
    } finally {
        const closed = once(child, 'exit')
        if (child.exitCode === null) { child.kill(); await closed }
        assert.equal(dirname(realpathSync(dataDirectory)), realpathSync(tmpdir()))
        assert.ok(dataDirectory.split(/[\\/]/).at(-1).startsWith('latamware-company-http-'))
        rmSync(dataDirectory, { recursive: true, force: true })
    }
}

await withServer(false, async ({ origin }) => {
    for (const path of ['/', '/login', '/api/access', '/api/health', '/api/auth/csrf']) {
        const response = await fetch(origin + path, { redirect: 'manual' })
        assert.equal(response.status, 503, `Missing configuration must block ${path}`)
    }
    console.log('PASS: incomplete production configuration blocks application, login, APIs and readiness')
})

await withServer(true, async ({ origin, secret }) => {
    assert.equal((await fetch(origin + '/api/health')).status, 200)
    const root = await fetch(origin, { redirect: 'manual' })
    assert.equal(root.status, 303)
    assert.equal(new URL(root.headers.get('location'), origin).pathname, '/login')
    assert.equal((await fetch(origin + '/api/access')).status, 401)
    const login = await fetch(origin + '/login')
    assert.equal(login.status, 200)
    const loginHtml = await login.text()
    assert.ok(loginHtml.includes('Continue with Google'))
    assert.ok(!loginHtml.includes(secret) && !loginHtml.includes('synthetic-secret'))
    assert.equal(loginHtml.includes('role="alert"'), false)
    for (const code of ['', 'SessionRequired', 'undefined']) {
        const response = await fetch(origin + '/login?error=' + encodeURIComponent(code))
        assert.equal(response.status, 200)
        assert.equal((await response.text()).includes('role="alert"'), false)
    }
    assert.equal((await fetch(origin + '/favicon.svg')).status, 200)
    const csrf = await fetch(origin + '/api/auth/csrf')
    assert.equal(csrf.status, 200)
    assert.equal(typeof (await csrf.json()).csrfToken, 'string')
    const forged = await fetch(origin + '/api/access', { headers: { cookie: 'authjs.session-token=forged' } })
    assert.equal(forged.status, 401)
    const expiredLogin = await fetch(origin + '/login', { headers: { cookie: 'authjs.session-token=forged' } })
    assert.equal(expiredLogin.status, 200)
    assert.equal((await expiredLogin.text()).includes('role="alert"'), false)

    for (const [email, hd, permitted] of [
        ['employee@latamware.com', 'latamware.com', true],
        ['employee@iguapp.tur.ar', 'iguapp.tur.ar', true],
        ['dapris12@gmail.com', undefined, true],
        ['someone@gmail.com', undefined, false],
        ['employee@latamware.com', undefined, false]
    ]) {
        // Synthetic encrypted application session, not a simulated Google ID token.
        const token = await encode({ secret, salt: 'authjs.session-token', maxAge: 3600, token: {
            vaultIdentity: { sub: 'synthetic-' + email, email, email_verified: true, ...(hd ? { hd } : {}) },
            vaultAuthenticatedAt: Math.floor(Date.now() / 1000)
        } })
        const headers = { cookie: `authjs.session-token=${token}` }
        const response = await fetch(origin + '/api/access', { headers })
        assert.equal(response.status, permitted ? 200 : 401, email)
        if (permitted) {
            assert.deepEqual(await response.json(), { user: { id: 'synthetic-' + email, email, isAdmin: false } })
            const page = await fetch(origin, { headers, redirect: 'manual' })
            assert.equal(page.status, 200)
            assert.equal(page.headers.get('cache-control'), 'no-store')
            assert.ok((await page.text()).includes(email))
            if (email === 'employee@latamware.com') {
                const legacy = await fetch(origin + '/api/auth/signout', { headers, redirect: 'manual' })
                assert.equal(new URL(legacy.headers.get('location'), origin).pathname, '/logout')
                const confirmation = await fetch(origin + '/logout', { headers })
                assert.equal(confirmation.status, 200)
                assert.ok((await confirmation.text()).includes('Are you sure you want to sign out?'))
                assert.equal((await fetch(origin + '/api/access', { headers })).status, 200, 'GET confirmation must not end the session')
                const noCsrf = await fetch(origin + '/api/auth/signout', {
                    method: 'POST', redirect: 'manual', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: ''
                })
                assert.match(noCsrf.headers.get('location'), /error=MissingCSRF/)
                assert.equal((await fetch(origin + '/api/access', { headers })).status, 200)
                const csrfResponse = await fetch(origin + '/api/auth/csrf', { headers })
                const { csrfToken } = await csrfResponse.json()
                const cookie = headers.cookie + '; ' + csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
                const signout = await fetch(origin + '/api/auth/signout', {
                    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ csrfToken, callbackUrl: '/login' })
                })
                assert.equal(signout.status, 302)
                assert.equal(new URL(signout.headers.get('location'), origin).pathname, '/login')
                assert.ok(signout.headers.getSetCookie().some(value => value.startsWith('authjs.session-token=;') && value.includes('Max-Age=0')))
            }
        }
    }
    const makeCookie = async (email, hd) => 'authjs.session-token=' + await encode({ secret, salt: 'authjs.session-token', maxAge: 3600, token: {
        vaultIdentity: { sub: 'synthetic-' + email, email, email_verified: true, ...(hd ? { hd } : {}) }, vaultAuthenticatedAt: Date.now() / 1000
    } })
    const admin = await makeCookie('admin@latamware.com', 'latamware.com')
    const reader = await makeCookie('dapris12@gmail.com')
    let editor = await makeCookie('gorguesraul01@gmail.com')
    const api = async (cookie, path = '', method = 'GET', body = {}, extraHeaders = {}) => {
        const response = await fetch(origin + '/api/company' + path, {
            method, redirect: 'manual', headers: { cookie, ...(method !== 'GET' ? { origin, 'content-type': 'application/json', 'x-vault-request': '1' } : {}), ...extraHeaders },
            ...(method !== 'GET' ? { body: JSON.stringify(body) } : {})
        })
        return { status: response.status, data: await response.json() }
    }
    const adminBoot = await api(admin)
    assert.equal(adminBoot.status, 200)
    assert.equal(adminBoot.data.me.isAdmin, true)
    assert.equal((await api(reader)).data.me.isAdmin, false)
    assert.equal((await api(reader)).data.vaults.length, 0)
    const created = await api(admin, '/vaults', 'POST', { name: 'Shared infrastructure' })
    assert.equal(created.status, 200)
    const id = created.data.id
    const credential = { kind: 'password', title: 'Synthetic hosting', username: 'test-user', password: 'synthetic-credential-123!', url: 'https://example.test', notes: 'synthetic notes' }
    const saved = await api(admin, `/vaults/${id}/items`, 'POST', { content: credential })
    assert.equal(saved.status, 200)
    assert.equal((await api(reader, `/vaults/${id}`)).status, 404)
    assert.equal((await api(admin, `/vaults/${id}/members`, 'POST', { email: 'dapris12@gmail.com', role: 'reader' })).status, 200)
    assert.equal((await api(reader, `/vaults/${id}`)).data.items[0].password, credential.password)
    const initialHtml = await (await fetch(origin + '/', { headers: { cookie: reader } })).text()
    assert.ok(initialHtml.includes('Shared infrastructure'), 'shared vault index must be in the initial HTML')
    assert.equal(initialHtml.includes(credential.password), false, 'bootstrap must not serialize credentials')
    const itemPath = `/vaults/${id}/items/${saved.data.id}`
    assert.equal((await api(reader, itemPath + '/pin', 'POST', { pinned: true })).status, 200)
    assert.equal((await api(reader, `/vaults/${id}`)).data.items[0].pinned, true)
    assert.equal((await api(admin, `/vaults/${id}`)).data.items[0].pinned, false)
    assert.equal((await api(reader, itemPath + '/copy', 'POST', { field: 'username' })).data.value, credential.username)
    assert.equal((await api(reader, itemPath + '/copy', 'POST', { field: 'password' })).data.value, credential.password)
    assert.equal((await api(reader, itemPath + '/copy', 'POST', { field: 'password' }, { origin: 'https://attacker.test' })).status, 403)
    const activity = (await api(admin, `/vaults/${id}/audit`)).data
    assert.ok(activity.some(entry => entry.action === 'item.password_copy_requested' && entry.actor === 'dapris12@gmail.com' && entry.target === credential.title))
    assert.equal(JSON.stringify(activity).includes(credential.password), false)
    const backup = await api(reader, '/export', 'POST', { vaultIds: [id] })
    assert.equal(backup.status, 200)
    assert.equal(backup.data.vaults[0].items[0].password, credential.password)
    assert.equal((await api(reader, '/export', 'POST', { vaultIds: [adminBoot.data.vaults[0].id] })).status, 404)
    assert.equal((await api(reader, `/vaults/${id}/items`, 'POST', { content: credential })).status, 403)
    assert.equal((await api(reader, '/admin')).status, 403)
    assert.equal((await api(admin, `/vaults/${id}/members`, 'POST', { email: 'gorguesraul01@gmail.com', role: 'editor' })).status, 200)
    assert.equal((await api(admin, `/vaults/${id}/members`)).data.find(member => member.email === 'gorguesraul01@gmail.com').pending, true)
    assert.equal((await api(editor, `/vaults/${id}`)).data.role, 'editor')
    assert.equal((await api(editor, `/vaults/${id}/items/${saved.data.id}`, 'PATCH', { content: { ...credential, password: 'updated-synthetic-password' }, version: 1 })).status, 200)
    assert.equal((await api(admin, `/vaults/${id}/items/${saved.data.id}`, 'PATCH', { content: credential, version: 1 })).status, 409)
    assert.equal((await api(reader, `/vaults/${id}`)).data.items[0].password, 'updated-synthetic-password')
    assert.equal((await api(admin, '/vaults', 'POST', { name: 'Forged origin' }, { origin: 'https://attacker.test' })).status, 403)
    assert.equal((await api(admin, '/vaults', 'POST', { name: 'Missing origin' }, { origin: '' })).status, 403)
    assert.equal((await api(admin, '/vaults', 'POST', { name: 'Missing CSRF header' }, { 'x-vault-request': '' })).status, 403)
    const membership = (await api(admin, `/vaults/${id}/members`)).data.find(member => member.email === 'dapris12@gmail.com')
    assert.equal((await api(admin, `/vaults/${id}/members/${membership.id}`, 'DELETE')).status, 200)
    assert.equal((await api(reader, `/vaults/${id}`)).status, 404)
    assert.equal((await api(reader, itemPath + '/pin', 'POST', { pinned: false })).status, 404)
    assert.equal((await api(reader, itemPath + '/copy', 'POST', { field: 'password' })).status, 404)
    assert.equal((await api(reader, '/export', 'POST', { vaultIds: [id] })).status, 404)
    const privateVault = (await api(editor, '/vaults', 'POST', { name: 'Private to editor' })).data.id
    assert.equal((await api(admin, `/vaults/${privateVault}`)).status, 404)
    assert.equal((await api(reader, `/admin/vaults/${privateVault}/recover`, 'POST')).status, 403)
    assert.equal((await api(admin, `/admin/vaults/${privateVault}/recover`, 'POST')).status, 200)
    assert.equal((await api(admin, `/vaults/${privateVault}`)).data.role, 'admin')
    assert.ok((await api(admin, `/vaults/${privateVault}/audit`)).data.some(entry => entry.action === 'vault.recovered'))
    assert.equal((await api(admin, '/admin/users/synthetic-gorguesraul01%40gmail.com/status', 'POST', { disabled: true })).status, 200)
    assert.equal((await api(editor)).status, 401)
    const disabledLogin = await fetch(origin + '/login', { headers: { cookie: editor }, redirect: 'manual' })
    assert.equal(disabledLogin.status, 200, 'disabled sessions must not cause a login redirect loop')
    assert.equal((await api(admin, '/admin/users/synthetic-gorguesraul01%40gmail.com/status', 'POST', { disabled: false })).status, 200)
    assert.equal((await api(editor)).status, 401, 'reenabling does not restore old sessions')
    await delay(5)
    editor = await makeCookie('gorguesraul01@gmail.com')
    assert.equal((await api(editor)).status, 200)
    assert.equal((await api(editor, '/me/revoke-sessions', 'POST')).status, 200)
    assert.equal((await api(editor)).status, 401)
    console.log('PASS: corporate Google identities, shared encrypted data, all permission checks, CSRF, edit conflicts, recovery and session revocation')
})
