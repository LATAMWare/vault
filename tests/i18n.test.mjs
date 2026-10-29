import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { setupBrowser, fixtureAccount } from './browser.mjs'

setupBrowser()
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { default: Page } = await import('../src/components/page/index.tsx')
const { default: DialogOption } = await import('../src/components/ui/dialog/option.tsx')
const { t, i18n, setLanguage, detectLanguage, LANGUAGE_STORAGE_KEY } = await import('../src/logic/i18n.ts')
const { setStorage, getStorage } = await import('../src/logic/storage.ts')
const spanish = JSON.parse(fs.readFileSync(new URL('../src/locales/es.json', import.meta.url), 'utf8'))

test('every declared translation and settings/help entry has a complete Spanish catalog entry', () => {
    const keys = new Set(['Language', 'VAULT - Password Manager'])
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name)
            if (entry.isDirectory()) { walk(file); continue }
            if (!/\.tsx?$/.test(file) || file.endsWith('i18n.ts')) continue
            const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
            const visit = node => {
                if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text)
                if (file.endsWith('settings.ts') && ts.isPropertyAssignment(node) && ['name', 'description', 'placeholder'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) keys.add(node.initializer.text)
                if (file.replaceAll('\\', '/').endsWith('faq/index.tsx') && ts.isStringLiteral(node) && ts.isArrayLiteralExpression(node.parent)) keys.add(node.text)
                ts.forEachChild(node, visit)
            }
            visit(source)
        }
    }
    walk('src/components'); walk('src/logic')
    assert.deepEqual([...keys].filter(key => !spanish[key]), [])
    const variables = value => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]).sort()
    for (const [key, translation] of Object.entries(spanish)) assert.deepEqual(variables(translation), variables(key), `Interpolation mismatch: ${key}`)
})

test('Spanish/English flags update the interface without losing typed inputs or modifying vault data', async () => {
    Object.defineProperty(window.navigator, 'language', { value: 'es-AR', configurable: true })
    window.localStorage.clear()
    const account = fixtureAccount(); setStorage('untouched', account)
    const before = JSON.stringify(getStorage('untouched'))
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Page)))
        assert.ok(host.textContent.includes('Crear cuenta'))
        assert.ok(host.textContent.includes('Una cuenta local agrupa tus bóvedas bajo una misma contraseña maestra.'))
        assert.ok(host.textContent.includes('No permiten recuperarla.'))
        assert.equal(host.textContent.includes('Remember them when you create your account.'), false)
        assert.equal(document.documentElement.lang, 'es')
        assert.equal(document.title, 'VAULT - Gestor de contraseñas')
        assert.equal(host.textContent.includes('free forever'), false)
        assert.equal(host.textContent.includes('Legal Notice'), false)
        assert.equal(host.textContent.includes('Crafted'), false)
        const input = host.querySelector('input[name=password]')
        await act(async () => {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'unsaved fixture password')
            input.dispatchEvent(new window.Event('input', { bubbles: true }))
        })
        const flags = host.querySelector('[role=group]')
        assert.ok(flags)
        assert.equal(flags.querySelector('summary').textContent.trim(), '', 'closed selector shows only the selected flag')
        await act(async () => flags.querySelector('summary').click())
        assert.equal(flags.querySelector('details').open, true)
        await act(async () => host.querySelector('button[aria-label=English]').click())
        assert.ok(host.textContent.includes('Create local account'))
        assert.ok(host.textContent.includes('They cannot recover it.'))
        assert.equal(input.value, 'unsaved fixture password')
        assert.equal(window.localStorage.getItem(LANGUAGE_STORAGE_KEY), 'en')
        assert.equal(document.documentElement.lang, 'en')
        await act(async () => flags.querySelector('summary').click())
        await act(async () => host.querySelector('button[aria-label=Español]').click())
        assert.ok(host.textContent.includes('Crear cuenta'))
        assert.equal(JSON.stringify(getStorage('untouched')), before)
        await act(async () => host.querySelector('button[aria-label="Abrir menú"]').click())
        assert.equal(host.querySelectorAll('[role=group]').length, 2, 'mobile hamburger must include language flags')
    } finally {
        await act(async () => root.unmount()); host.remove()
        await setLanguage('en'); window.localStorage.clear()
    }
})

test('language preference survives remount and invalid preferences have a safe fallback', async () => {
    await setLanguage('es')
    assert.equal(detectLanguage(), 'es')
    await i18n.changeLanguage('en')
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => root.render(React.createElement(Page)))
        assert.equal(document.documentElement.lang, 'es')
        assert.ok(host.textContent.includes('Crear cuenta'))
    } finally { await act(async () => root.unmount()); host.remove() }
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'unsupported')
    Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true })
    assert.equal(detectLanguage(), 'en')
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY)
    await setLanguage('en', false)
    assert.equal(i18n.resolvedLanguage, 'en')
})

test('localized interpolated account names remain inert text in alerts and dialog descriptions', async () => {
    await setLanguage('es', false)
    const payload = '<img src=x onerror="document.title=\'unsafe\'">'
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const description = t('Enter the password for {{value0}} to switch to it.', { value0: payload })
    try {
        await act(async () => root.render(React.createElement(DialogOption, { title: 'Fixture', description, children: null })))
        assert.equal(host.querySelector('img'), null)
        assert.ok(host.textContent.includes(payload))
        assert.ok(host.textContent.includes('Ingresá la contraseña'))
    } finally { await act(async () => root.unmount()); host.remove(); await setLanguage('en', false) }
})
