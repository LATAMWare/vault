import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { setupBrowser } from './browser.mjs'

setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
window.HTMLDialogElement.prototype.close = function () { this.open = false }
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Company } = await import('../src/components/company/index.tsx')
const { setLanguage } = await import('../src/logic/i18n.ts')

async function withCompany(role, check, bootstrap = false) {
    const originalFetch = globalThis.fetch
    const me = { id: 'fixture-google-sub', email: 'user@latamware.test', isAdmin: false }
    const item = { id: 'item', version: 1, updatedAt: Date.now(), pinned: false, kind: 'password', title: '<img src=x onerror=alert(1)>', username: 'fixture-user', password: 'synthetic-plain-credential-42!', url: 'javascript:alert(1)', notes: 'fixture note' }
    const vault = { id: 'vault', name: 'Infrastructure', role, version: 1, updatedAt: Date.now(), itemCount: 1 }
    let permitted = true
    const requests = []
    globalThis.fetch = async (path, options = {}) => {
        requests.push({ path, method: options.method ?? 'GET', body: options.body })
        if (path === '/api/company') return Response.json({ me, vaults: permitted ? [vault] : [] })
        if (path === '/api/company/vaults/vault') return permitted ? Response.json({ ...vault, items: [item] }) : Response.json({ error: 'Vault not found or access was removed.' }, { status: 404 })
        if (path === '/api/company/vaults/vault/items/item/pin') return Response.json({ pinned: JSON.parse(options.body).pinned })
        if (path === '/api/company/vaults/vault/items/item/copy') return permitted ? Response.json({ value: item[JSON.parse(options.body).field] }) : Response.json({ error: 'Vault not found or access was removed.' }, { status: 404 })
        throw new Error('Unexpected synthetic UI request')
    }
    window.localStorage.clear()
    window.localStorage.setItem('vault:language', 'es')
    window.localStorage.setItem('legacy-sentinel', 'unchanged')
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Company, { user: me, ...(bootstrap ? { initialVaults: [vault] } : {}) })))
        await check({ host, item, requests, revoke: () => { permitted = false } })
    } finally { await act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; window.localStorage.clear(); await setLanguage('en', false) }
}

test('server-provided vault index renders immediately without a duplicate bootstrap request', async () => {
    await withCompany('reader', async ({ host, requests }) => {
        assert.ok(host.textContent.includes('Infrastructure'))
        assert.equal(host.textContent.includes('Cargando bóvedas'), false)
        assert.equal(requests.length, 0)
        await act(async () => host.querySelector('.cw-nav-list button').click())
        assert.equal(requests.length, 1)
        assert.equal(requests[0].path, '/api/company/vaults/vault')
    }, true)
})

test('readers can pin items and copy username/password through the audited server endpoint', async () => {
    const copied = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied.push(value) } } })
    await withCompany('reader', async ({ host, item, requests, revoke }) => {
        await act(async () => host.querySelector('.cw-nav-list button').click())
        await act(async () => host.querySelector('article button[aria-label^="Fijar"]').click())
        assert.equal(host.querySelector('article button[aria-label^="Desfijar"]').getAttribute('aria-pressed'), 'true')
        await act(async () => host.querySelector('article button[title="Copiar usuario"]').click())
        await act(async () => host.querySelector('article button[title="Copiar contraseña"]').click())
        assert.deepEqual(copied, [item.username, item.password])
        assert.deepEqual(requests.filter(request => request.path.endsWith('/copy')).map(request => JSON.parse(request.body).field), ['username', 'password'])
        revoke()
        await act(async () => host.querySelector('article button[title="Copiar contraseña"]').click())
        assert.equal(copied.length, 2, 'removed permissions must block copying even if an item is still rendered')
    })
})

test('company mode opens directly with Google, renders user data as text and never saves credentials in localStorage', async () => {
    await withCompany('owner', async ({ host, item }) => {
        assert.ok(host.querySelector('h1').textContent.includes('Tus bóvedas'))
        assert.equal(host.querySelector('input[type=password]'), null)
        assert.equal(host.textContent.includes('Crear cuenta local'), false)
        await act(async () => host.querySelector('.cw-nav-list button').click())
        const article = host.querySelector('article')
        assert.ok(article.textContent.includes(item.title))
        assert.equal(article.querySelector('img'), null)
        assert.equal(article.querySelector('a[href^="javascript:"]'), null)
        assert.equal(article.textContent.includes(item.password), false)
        await act(async () => article.querySelector('button[aria-label^="Mostrar"]').click())
        assert.ok(article.textContent.includes(item.password))
        assert.equal(Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.getItem(window.localStorage.key(index))).join('').includes(item.password), false)
        assert.equal(window.localStorage.getItem('legacy-sentinel'), 'unchanged')
    })
})

test('reader UI exposes only reading actions and removes revealed data when access is revoked', async () => {
    await withCompany('reader', async ({ host, item, revoke }) => {
        await act(async () => host.querySelector('.cw-nav-list button').click())
        assert.equal(host.querySelector('.cw-heading-actions .cw-button-primary'), null)
        assert.equal(host.querySelector('article details'), null)
        assert.equal([...host.querySelectorAll('button')].some(button => button.textContent === 'Compartir'), false)
        await act(async () => host.querySelector('article button[aria-label^="Mostrar"]').click())
        assert.ok(host.textContent.includes(item.password))
        revoke()
        await act(async () => window.dispatchEvent(new window.Event('focus')))
        assert.equal(host.querySelector('article'), null)
        assert.equal(host.textContent.includes(item.password), false)
    })
})

test('create-vault dialog focuses its named field and Escape cancellation never creates a vault', async () => {
    await withCompany('owner', async ({ host, requests }) => {
        await act(async () => host.querySelector('.cw-page-heading button').click())
        const dialog = host.querySelector('dialog[open]')
        assert.equal(dialog.open, true)
        assert.equal(document.activeElement, dialog.querySelector('input'))
        assert.ok(dialog.getAttribute('aria-labelledby'))
        await act(async () => dialog.dispatchEvent(new window.Event('cancel', { cancelable: true })))
        assert.equal(host.querySelector('dialog[open]'), null)
        assert.equal(requests.filter(request => request.method === 'POST').length, 0)
    })
})

test('mobile navigation animates closing, closes immediately for reduced motion and keeps create-dialog focus', async () => {
    const originalMatchMedia = window.matchMedia
    let reduced = false
    window.matchMedia = () => ({ matches: reduced })
    try {
        await withCompany('reader', async ({ host }) => {
            const menu = host.querySelector('#company-mobile-navigation')
            assert.equal(menu.open, false)
            const trigger = host.querySelector('[data-company-mobile-menu]')
            await act(async () => trigger.click())
            assert.equal(menu.open, true)
            assert.equal(trigger.getAttribute('aria-expanded'), 'true')
            await act(async () => menu.querySelector('.cw-dialog-header button').click())
            assert.equal(menu.dataset.closing, 'true')
            await act(async () => delay(230))
            assert.equal(menu.open, false)
            reduced = true
            await act(async () => trigger.click())
            await act(async () => menu.querySelector('.cw-dialog-header button').click())
            assert.equal(menu.open, false)
            await act(async () => trigger.click())
            await act(async () => [...menu.querySelectorAll('button')].find(button => button.textContent === 'Crear bóveda').click())
            const create = host.querySelector('dialog[open]')
            assert.notEqual(create, menu)
            assert.equal(document.activeElement, create.querySelector('input'))
        })
    } finally { window.matchMedia = originalMatchMedia }
})
