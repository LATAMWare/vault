import { JSDOM } from 'jsdom'
export const setupBrowser = () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://vault.test', pretendToBeVisual: true })
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.CustomEvent = dom.window.CustomEvent
    globalThis.FileReader = dom.window.FileReader
    globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
    globalThis.MutationObserver = dom.window.MutationObserver
    globalThis.HTMLElement = dom.window.HTMLElement
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
    return dom
}
export const fixtureAccount = () => ({
    settings: [{ id: 'account-name', value: 'Fixture' }, { id: 'store-master-verifier', value: true }, { id: 'default-alphabet', value: 'a' }],
    alphabets: [{ id: 'a', name: 'Default', identifier: 'default', characters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!', icon: 'abc', description: '' }],
    vaults: [{ id: 'v', name: 'Fixture Vault', icon: 'vault' }], services: [], secrets: []
})
