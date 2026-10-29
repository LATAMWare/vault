import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser } from './browser.mjs'

setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Logout } = await import('../src/components/sections/logout/index.tsx')
const { setLanguage } = await import('../src/logic/i18n.ts')

async function withLogout(check) {
    window.localStorage.setItem('vault:language', 'es')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Logout)))
        await check(host)
    } finally {
        await act(async () => root.unmount())
        host.remove()
        window.localStorage.clear()
        await setLanguage('en', false)
    }
}

test('sign-out confirmation respects Spanish/English and opening/canceling never submits sign-out', async () => {
    const originalFetch = globalThis.fetch
    let requests = 0
    globalThis.fetch = async () => { requests++; throw new Error('Unexpected request') }
    try {
        await withLogout(async host => {
            assert.equal(host.querySelector('h1').textContent, 'Cerrar sesión')
            assert.ok(host.textContent.includes('¿Querés cerrar sesión?'))
            assert.equal(host.querySelector('a').textContent, 'Cancelar')
            assert.equal(host.querySelector('a').getAttribute('href'), '/')
            assert.equal(document.title, 'Cerrar sesión - LATAMWare Vault')
            await act(async () => host.querySelector('button[aria-label=English]').click())
            assert.equal(host.querySelector('h1').textContent, 'Sign out')
            assert.ok(host.textContent.includes('Are you sure you want to sign out?'))
            await act(async () => host.querySelector('button[aria-label=Español]').click())
            assert.equal(host.querySelector('h1').textContent, 'Cerrar sesión')
            assert.equal(requests, 0)
        })
    } finally { globalThis.fetch = originalFetch }
})

test('sign-out requires confirmation and a CSRF token, with localized retry after a connection failure', async () => {
    const originalFetch = globalThis.fetch
    const originalSubmit = window.HTMLFormElement.prototype.submit
    let submitted = 0
    window.HTMLFormElement.prototype.submit = function () {
        submitted++
        assert.equal(this.method, 'post')
        assert.equal(this.getAttribute('action'), '/api/auth/signout')
        assert.equal(this.elements.namedItem('csrfToken').value, 'synthetic-csrf')
        assert.equal(this.elements.namedItem('callbackUrl').value, '/login')
    }
    try {
        await withLogout(async host => {
            globalThis.fetch = async () => { throw new TypeError('Synthetic offline state') }
            await act(async () => host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
            assert.ok(host.querySelector('[role=alert]').textContent.includes('No se pudo cerrar la sesión.'))
            assert.equal(submitted, 0)
            assert.equal(host.querySelector('button[type=submit]').disabled, false)
            globalThis.fetch = async () => Response.json({ csrfToken: 'synthetic-csrf' })
            await act(async () => host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
            assert.equal(host.querySelector('[role=alert]'), null)
            assert.equal(submitted, 1)
            assert.equal(host.querySelector('button[type=submit]').textContent, 'Cerrando sesión…')
        })
    } finally { globalThis.fetch = originalFetch; window.HTMLFormElement.prototype.submit = originalSubmit }
})
