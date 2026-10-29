import assert from 'node:assert/strict'
import test from 'node:test'
import { Auth } from '@auth/core'
import { encode } from '@auth/core/jwt'
import { parseAccessPolicy, isAllowedIdentity } from '../src/server/access-policy.ts'
import { readAuthSettings, createAuthConfig, handleAuth, readAuthSession } from '../src/server/auth.ts'

const env = {
    NODE_ENV: 'production', VAULT_AUTH_MODE: 'google', VAULT_AUTH_ORIGIN: 'http://127.0.0.1:4321',
    AUTH_SECRET: 'synthetic-test-secret-0123456789-abcdef-987654321',
    GOOGLE_AUTH_CLIENT_ID: 'synthetic-client', GOOGLE_AUTH_CLIENT_SECRET: 'synthetic-secret',
    VAULT_ALLOWED_DOMAINS: 'latamware.com,iguapp.tur.ar', VAULT_ALLOWED_EMAILS: 'dapris12@gmail.com'
}
const identity = (email, hd) => ({ sub: 'google-test-subject', email, email_verified: true, ...(hd ? { hd } : {}) })
const cookieFor = async (profile, settings, authenticatedAt = Math.floor(Date.now() / 1000)) => {
    const token = await encode({ secret: settings.secret, salt: 'authjs.session-token', maxAge: 3600, token: {
        vaultIdentity: profile, vaultAuthenticatedAt: authenticatedAt
    } })
    return `authjs.session-token=${token}`
}

test('access policy permits exact Workspace domains or a verified exact email and rejects lookalikes', () => {
    const policy = parseAccessPolicy(' LATAMWare.com,iguapp.tur.ar,latamware.com ', ' Dapris12@gmail.com ')
    assert.deepEqual(policy.domains, ['latamware.com', 'iguapp.tur.ar'])
    assert.equal(isAllowedIdentity(identity('employee@latamware.com', 'latamware.com'), policy), true)
    assert.equal(isAllowedIdentity(identity('employee@iguapp.tur.ar', 'iguapp.tur.ar'), policy), true)
    assert.equal(isAllowedIdentity(identity('DAPRIS12@GMAIL.COM'), policy), true)
    for (const profile of [
        identity('other@gmail.com'), identity('dapris12+alias@gmail.com'), identity('dapris.12@gmail.com'),
        identity('employee@latamware.com'), identity('employee@latamware.com', 'attacker.com'),
        identity('employee@sub.latamware.com', 'sub.latamware.com'), identity('employee@evil-latamware.com', 'evil-latamware.com'),
        identity('employee@latamware.com.evil.com', 'latamware.com.evil.com'),
        { ...identity('dapris12@gmail.com'), email_verified: false },
        { ...identity('dapris12@gmail.com'), email_verified: 'true' },
        { email: 'dapris12@gmail.com', email_verified: true }, null
    ]) assert.equal(isAllowedIdentity(profile, policy), false, JSON.stringify(profile))
    assert.throws(() => parseAccessPolicy('*.latamware.com', ''), /exact domains/)
    assert.throws(() => parseAccessPolicy('https://latamware.com', ''), /exact domains/)
    assert.throws(() => parseAccessPolicy('', '*@gmail.com'), /exact email/)
    assert.throws(() => parseAccessPolicy('', ''), /At least one/)
    assert.equal(isAllowedIdentity(identity('dapris12@gmail.com'), parseAccessPolicy('', 'dapris12@gmail.com')), true)
})

test('production configuration fails closed and uses only latamware.com by default', () => {
    assert.throws(() => readAuthSettings({ NODE_ENV: 'production' }), /Missing/)
    assert.equal(readAuthSettings({ NODE_ENV: 'development' }).mode, 'local')
    assert.equal(readAuthSettings({ NODE_ENV: 'production', VAULT_AUTH_MODE: 'local' }).mode, 'local')
    assert.throws(() => readAuthSettings({ ...env, VAULT_AUTH_MODE: 'typo' }), /VAULT_AUTH_MODE/)
    assert.throws(() => readAuthSettings({ ...env, AUTH_SECRET: 'short' }), /32 random bytes/)
    for (const origin of ['http://vault.example.com', 'https://vault.example.com/extra', 'https://user:pass@vault.example.com', 'https://vault.example.com?test=1']) {
        assert.throws(() => readAuthSettings({ ...env, VAULT_AUTH_ORIGIN: origin }))
    }
    const defaults = readAuthSettings({ ...env, VAULT_ALLOWED_DOMAINS: undefined, VAULT_ALLOWED_EMAILS: undefined })
    assert.deepEqual(defaults.policy, { domains: ['latamware.com'], emails: [] })
    assert.throws(() => readAuthSettings({ ...env, VAULT_ALLOWED_DOMAINS: '', VAULT_ALLOWED_EMAILS: '' }))
})

test('Auth.js sessions reject forged cookies, removed rules, expired authentication and client claim changes', async () => {
    const settings = readAuthSettings(env)
    const cookie = await cookieFor(identity('employee@iguapp.tur.ar', 'iguapp.tur.ar'), settings)
    const request = new Request(env.VAULT_AUTH_ORIGIN, { headers: { cookie } })
    const session = await readAuthSession(request, settings)
    assert.deepEqual(session.user, { id: 'google-test-subject', email: 'employee@iguapp.tur.ar' })
    assert.ok(session.cookies.some(value => value.includes('HttpOnly') && value.includes('SameSite=Lax')))
    assert.equal((await readAuthSession(new Request(env.VAULT_AUTH_ORIGIN), settings)).user, null)
    const revoked = readAuthSettings({ ...env, VAULT_ALLOWED_DOMAINS: 'latamware.com', VAULT_ALLOWED_EMAILS: '' })
    assert.equal((await readAuthSession(request, revoked)).user, null)
    const forged = new Request(env.VAULT_AUTH_ORIGIN, { headers: { cookie: 'authjs.session-token=forged' } })
    assert.equal((await readAuthSession(forged, settings)).user, null)
    const old = await cookieFor(identity('dapris12@gmail.com'), settings, Math.floor(Date.now() / 1000) - 3601)
    assert.equal((await readAuthSession(new Request(env.VAULT_AUTH_ORIGIN, { headers: { cookie: old } }), settings)).user, null)
    const callbacks = createAuthConfig(settings).callbacks
    assert.equal(await callbacks.signIn({ account: { provider: 'google' }, profile: identity('other@gmail.com') }), false)
    assert.equal(await callbacks.signIn({ account: { provider: 'other' }, profile: identity('dapris12@gmail.com') }), false)
    const token = await callbacks.jwt({ token: {}, account: { provider: 'google' }, profile: identity('dapris12@gmail.com') })
    const updated = await callbacks.jwt({ token, trigger: 'update', session: { vaultIdentity: identity('attacker@gmail.com') } })
    assert.equal(updated.vaultIdentity.email, 'dapris12@gmail.com')
})

test('Auth.js supplies CSRF, rejects cross-origin and missing-CSRF posts, and ignores forwarded host', async () => {
    const settings = readAuthSettings(env)
    const csrf = await handleAuth(new Request('http://untrusted-host/api/auth/csrf', { headers: { 'x-forwarded-host': 'attacker.com', host: 'attacker.com' } }), settings)
    assert.equal(csrf.status, 200)
    const { csrfToken } = await csrf.json()
    assert.equal(typeof csrfToken, 'string')
    assert.ok(csrf.headers.getSetCookie().some(value => value.includes('HttpOnly')))
    assert.equal(csrf.headers.get('cache-control'), 'no-store')
    const foreign = await handleAuth(new Request(`${settings.origin}/api/auth/signin/google`, {
        method: 'POST', headers: { origin: 'https://attacker.com' }, body: 'csrfToken=anything'
    }), settings)
    assert.equal(foreign.status, 403)
    const missing = await handleAuth(new Request(`${settings.origin}/api/auth/signin/google`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: ''
    }), settings)
    assert.equal(missing.status, 302)
    assert.equal(new URL(missing.headers.get('location')).origin, settings.origin)
    assert.match(missing.headers.get('location'), /error=/)
    const secureSettings = readAuthSettings({ ...env, VAULT_AUTH_ORIGIN: 'https://vault.example.com' })
    const secure = await handleAuth(new Request('https://vault.example.com/api/auth/csrf'), secureSettings)
    assert.ok(secure.headers.getSetCookie().some(value => value.includes('Secure;') || value.endsWith('Secure')))
    const redirect = await createAuthConfig(settings).callbacks.redirect({ url: 'https://attacker.com', baseUrl: 'https://attacker.com' })
    assert.equal(redirect, `${settings.origin}/`)
    // Even a correctly formed client session-update POST cannot replace trusted identity claims.
    const invalidUpdate = await Auth(new Request(`${settings.origin}/api/auth/session`, { method: 'POST', body: '{}' }), createAuthConfig(settings))
    assert.equal(invalidUpdate.status, 400)
})

test('a CSRF-protected sign-in starts Google OIDC with state, nonce, PKCE and the canonical callback', async () => {
    const settings = readAuthSettings(env)
    const csrf = await handleAuth(new Request(`${settings.origin}/api/auth/csrf`), settings)
    const { csrfToken } = await csrf.json()
    const cookie = csrf.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const config = createAuthConfig(settings)
    // Supply Google's public authorization endpoint to avoid network discovery in this test.
    config.providers[0].options.authorization.url = 'https://accounts.google.com/o/oauth2/v2/auth'
    const response = await Auth(new Request(`${settings.origin}/api/auth/signin/google`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrfToken, callbackUrl: '/' })
    }), config)
    assert.equal(response.status, 302)
    const target = new URL(response.headers.get('location'))
    assert.equal(target.origin, 'https://accounts.google.com')
    assert.equal(target.searchParams.get('client_id'), env.GOOGLE_AUTH_CLIENT_ID)
    assert.equal(target.searchParams.get('redirect_uri'), `${settings.origin}/api/auth/callback/google`)
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256')
    for (const parameter of ['state', 'nonce', 'code_challenge']) assert.ok(target.searchParams.get(parameter))
    assert.equal(target.searchParams.has('hd'), false)
})
