import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser } from './browser.mjs'

setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Login } = await import('../src/components/sections/login/index.tsx')
const { setLanguage } = await import('../src/logic/i18n.ts')

async function withLogin(code, check) {
    const url = new URL('/login', window.location.origin)
    if (code !== null) url.searchParams.set('error', code)
    window.history.replaceState({ fixture: true }, '', url)
    window.localStorage.setItem('vault:language', 'es')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Login, { errorCode: code })))
        await check(host)
    } finally {
        await act(async () => root.unmount())
        host.remove()
        window.localStorage.clear()
        await setLanguage('en', false)
    }
}

test('anonymous, empty and session-required login pages never display an error or initiate a connection', async () => {
    const originalFetch = globalThis.fetch
    let requests = 0
    globalThis.fetch = async () => { requests++; throw new Error('Login must be explicit') }
    try {
        for (const code of [null, '', 'SessionRequired', 'undefined', '<img src=x onerror=alert(1)>']) {
            await withLogin(code, async host => {
                assert.equal(host.querySelector('[role=alert]'), null, String(code))
                assert.ok(host.textContent.includes('Ingresá con tu cuenta de Google autorizada.'))
                assert.equal(host.querySelector('button[type=submit]').disabled, false)
                assert.equal(new URL(window.location.href).searchParams.has('error'), false)
                assert.deepEqual(window.history.state, { fixture: true })
            })
        }
        assert.equal(requests, 0)
    } finally { globalThis.fetch = originalFetch }
})

test('real authentication failures are localized, consumed once and not replayed on refresh', async () => {
    for (const [code, message] of [
        ['AccessDenied', 'Tu cuenta de Google no tiene acceso autorizado.'],
        ['MissingCSRF', 'El intento de inicio de sesión venció.'],
        ['Configuration', 'El acceso con Google no está configurado correctamente.'],
        ['OAuthCallbackError', 'Google no pudo completar el inicio de sesión.']
    ]) {
        await withLogin(code, async host => {
            assert.ok(host.querySelector('[role=alert]').textContent.includes(message))
            assert.equal(new URL(window.location.href).searchParams.get('error'), null)
        })
        await withLogin(new URL(window.location.href).searchParams.get('error'), async host => {
            assert.equal(host.querySelector('[role=alert]'), null)
        })
    }
})

test('connection errors appear only after an explicit attempt and a successful retry submits the CSRF token', async () => {
    const originalFetch = globalThis.fetch
    const originalSubmit = window.HTMLFormElement.prototype.submit
    let submitted = 0
    window.HTMLFormElement.prototype.submit = function () {
        submitted++
        assert.equal(this.elements.namedItem('csrfToken').value, 'synthetic-csrf')
        assert.equal(this.getAttribute('action'), '/api/auth/signin/google')
    }
    try {
        await withLogin(null, async host => {
            globalThis.fetch = async () => { throw new TypeError('Synthetic offline state') }
            await act(async () => host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
            assert.ok(host.querySelector('[role=alert]').textContent.includes('Revisá tu conexión'))
            assert.equal(host.querySelector('button[type=submit]').disabled, false)
            globalThis.fetch = async () => Response.json({ csrfToken: 'synthetic-csrf' })
            await act(async () => host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
            assert.equal(host.querySelector('[role=alert]'), null)
            assert.equal(submitted, 1)
        })
    } finally { globalThis.fetch = originalFetch; window.HTMLFormElement.prototype.submit = originalSubmit }
})

test('an unavailable auth configuration is explained separately from a connection failure', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 })
    try {
        await withLogin(null, async host => {
            await act(async () => host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
            assert.ok(host.querySelector('[role=alert]').textContent.includes('no está configurado correctamente'))
            assert.equal(host.querySelector('button[type=submit]').disabled, false)
        })
    } finally { globalThis.fetch = originalFetch }
})
