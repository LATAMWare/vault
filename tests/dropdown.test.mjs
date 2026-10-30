import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { setupBrowser } from './browser.mjs'

setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'), { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Dropdown } = await import('../src/components/global/dropdown.tsx')
const { default: LanguageSelector } = await import('../src/components/global/language-selector.tsx')
const { setLanguage } = await import('../src/logic/i18n.ts')

test('floating row menus escape clipping, flip at the viewport edge and close when their scroll container moves', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Dropdown, { label: 'Last row', trigger: 'Options', floating: true },
            React.createElement('div', { className: 'cw-menu-popover' }, React.createElement('button', null, 'Edit')))))
        const menu = host.querySelector('details'), summary = host.querySelector('summary'), panel = host.querySelector('[popover]')
        let visible = false
        panel.showPopover = () => { visible = true }
        panel.hidePopover = () => { visible = false }
        summary.getBoundingClientRect = () => ({ top: window.innerHeight - 52, bottom: window.innerHeight - 20, right: window.innerWidth - 10 })
        panel.getBoundingClientRect = () => ({ width: 190, height: 104 })
        await act(async () => { summary.click(); await delay(10) })
        assert.equal(panel.getAttribute('popover'), 'manual')
        assert.equal(visible, true)
        assert.ok(Number.parseFloat(panel.style.top) + 104 < window.innerHeight - 52, 'all actions fit above the last row')
        await act(async () => panel.dispatchEvent(new window.Event('scroll')))
        assert.equal(menu.open, true, 'scrolling the menu does not dismiss it')
        await act(async () => { host.dispatchEvent(new window.Event('scroll')); await delay(10) })
        assert.equal(menu.open, false)
        assert.equal(visible, false)
        summary.getBoundingClientRect = () => ({ top: 20, bottom: 52, right: 100 })
        await act(async () => { summary.click(); await delay(10) })
        assert.equal(panel.style.top, '58px')
        assert.equal(panel.style.left, '8px', 'a narrow viewport does not push actions past the left edge')
    } finally { await act(async () => root.unmount()); host.remove() }
})

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
