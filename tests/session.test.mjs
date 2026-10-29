import assert from 'node:assert/strict'
import test from 'node:test'
import { setupBrowser, fixtureAccount } from './browser.mjs'
setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: EditAccount } = await import('../src/components/sections/accounts/edit.tsx')
const { default: Page } = await import('../src/components/page/index.tsx')
const { getStorage, setStorage } = await import('../src/logic/storage.ts')
const { setAccountMasterPassword, changeMasterPassword, checkAccountMasterPassword } = await import('../src/logic/account.ts')
const { decodeData } = await import('../src/logic/utils.ts')
const { watchPasswordChanges } = await import('../src/logic/session.ts')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await delay(20) }
    assert.fail('Expected UI state was not reached')
}
const untilUI = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await act(async () => delay(20)) }
    assert.fail('Expected UI state was not reached')
}
const button = text => Array.from(document.querySelectorAll('button')).find(element => element.textContent.trim() === text)
const fill = (element, value) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
}

test('password confirmation modal defaults to revocation, supports cancel, and can retain other sessions', async () => {
    setStorage('modal', fixtureAccount()); setStorage('current-account', 'modal')
    await setAccountMasterPassword({ accountId: 'modal', masterPassword: 'old fixture password' })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    let changed = '', notice
    const stop = watchPasswordChanges(value => { notice = value })
    try {
        await act(async () => root.render(React.createElement(EditAccount, { open: true, accountId: 'modal', onClose() {}, onUpdate() {}, onPasswordChanged: value => { changed = value } })))
        await act(async () => {
            fill(document.getElementById('current-master-password-edit'), 'old fixture password')
            fill(document.getElementById('new-master-password-edit'), 'new fixture password')
        })
        await act(async () => button('Change Master Password').click())
        await untilUI(() => document.querySelector('input[type=checkbox]'))
        assert.ok(document.querySelector('input[type=checkbox]'), document.body.textContent)
        assert.equal(document.querySelector('input[type=checkbox]').checked, true)
        await act(async () => button('Cancel').click())
        assert.equal(await checkAccountMasterPassword({ accountId: 'modal', masterPassword: 'old fixture password' }), true)
        await act(async () => button('Change Master Password').click())
        await untilUI(() => document.querySelector('input[type=checkbox]'))
        await act(async () => document.querySelector('input[type=checkbox]').click())
        await act(async () => { button('Confirm change').click(); await until(() => changed !== '') })
        await until(() => notice !== undefined)
        assert.equal(changed, 'new fixture password')
        assert.equal(getStorage('modal').session.revokePrevious, false)
        assert.equal(notice.closeOtherSessions, false)
        assert.equal(await decodeData('old fixture password', notice.handoff), changed)
    } finally { stop(); await act(async () => root.unmount()); host.remove() }
})

test('another unlocked tab keeps access when requested, then locks immediately when revoked', async () => {
    const account = fixtureAccount(); account.settings.push({ id: 'show-animations', value: false })
    setStorage('tab', account); setStorage('accounts', ['tab']); setStorage('current-account', 'tab')
    await setAccountMasterPassword({ accountId: 'tab', masterPassword: 'tab old password' })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Page)))
        const form = host.querySelector('form')
        Object.defineProperty(form, 'password', { value: form.querySelector('[name=password]') })
        await act(async () => fill(form.password, 'tab old password'))
        await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
        await untilUI(() => button('Settings'))
        assert.ok(button('Settings'))
        await act(async () => {
            assert.equal(await changeMasterPassword({ accountId: 'tab', currentMasterPassword: 'tab old password', newMasterPassword: 'tab second password', closeOtherSessions: false }), true)
            await delay(300)
        })
        assert.ok(button('Settings'), 'keep-sessions option must leave the other tab unlocked')
        await act(async () => {
            assert.equal(await changeMasterPassword({ accountId: 'tab', currentMasterPassword: 'tab second password', newMasterPassword: 'tab third password', closeOtherSessions: true }), true)
            await delay(200)
        })
        assert.ok(host.querySelector('input[name=password]'), 'revocation must return to the unlock screen')
        assert.equal(button('Settings'), undefined)
    } finally { await act(async () => root.unmount()); host.remove() }
})
