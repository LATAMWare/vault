import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser } from './browser.mjs'

setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Dropdown } = await import('../src/components/global/dropdown.tsx')
const { default: LanguageSelector } = await import('../src/components/global/language-selector.tsx')
const { setLanguage } = await import('../src/logic/i18n.ts')

test('dropdowns close on an outside pointer, Escape, leaving focus and choosing an action', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(React.Fragment, null,
            React.createElement(Dropdown, { label: 'Account', trigger: 'Open' }, React.createElement('button', { type: 'button' }, 'Action')),
            React.createElement('button', { id: 'outside', type: 'button' }, 'Outside'))))
        const menu = host.querySelector('details'), summary = host.querySelector('summary')
        const open = async () => { await act(async () => summary.click()); assert.equal(menu.open, true) }
        await open()
        await act(async () => host.querySelector('#outside').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })))
        assert.equal(menu.open, false)
        await open()
        await act(async () => summary.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
        assert.equal(menu.open, false); assert.equal(document.activeElement, summary)
        await open()
        await act(async () => host.querySelector('#outside').focus())
        assert.equal(menu.open, false)
        await open()
        await act(async () => menu.querySelector('button').click())
        assert.equal(menu.open, false)
    } finally { await act(async () => root.unmount()); host.remove() }
})

test('language dropdown supports arrow navigation, applies a language and restores trigger focus', async () => {
    await setLanguage('es')
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(LanguageSelector)))
        const summary = host.querySelector('summary'), menu = host.querySelector('details')
        summary.focus()
        await act(async () => summary.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
        assert.equal(menu.open, true)
        assert.equal(document.activeElement.getAttribute('aria-label'), 'Español')
        await act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
        assert.equal(document.activeElement.getAttribute('aria-label'), 'English')
        await act(async () => document.activeElement.click())
        assert.equal(menu.open, false)
        assert.equal(document.documentElement.lang, 'en')
        assert.equal(document.activeElement, summary)
        assert.equal(summary.textContent.trim(), '')
    } finally { await act(async () => root.unmount()); host.remove(); await setLanguage('en'); window.localStorage.clear() }
})
