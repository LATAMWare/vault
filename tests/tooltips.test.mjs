import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { setupBrowser } from './browser.mjs'
setupBrowser()
const { installTooltips } = await import('../src/logic/tooltips.ts')

test('custom tooltips support keyboard focus, Escape, existing descriptions and inert untrusted labels', async () => {
    const cleanup = installTooltips()
    const button = document.createElement('button')
    button.setAttribute('title', '<img src=x onerror=alert(1)>')
    button.setAttribute('aria-describedby', 'existing-help')
    document.body.append(button)
    try {
        button.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
        button.focus()
        await delay(270)
        const tooltip = document.querySelector('[role=tooltip]')
        assert.equal(tooltip.hidden, false)
        assert.equal(tooltip.textContent, '<img src=x onerror=alert(1)>')
        assert.equal(tooltip.querySelector('img'), null)
        assert.equal(button.hasAttribute('title'), false, 'avoid a duplicate native tooltip')
        assert.ok(button.getAttribute('aria-describedby').includes('existing-help'))
        button.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
        assert.equal(tooltip.hidden, true)
        assert.equal(button.getAttribute('aria-describedby'), 'existing-help')
    } finally { cleanup(); button.remove() }
})

test('delegated tooltips handle dynamically added hover controls, dismiss on scroll, and ignore touch hover', async () => {
    const cleanup = installTooltips()
    const button = document.createElement('button')
    button.dataset.tooltip = 'Copy username'
    document.body.append(button)
    try {
        const touch = new window.MouseEvent('pointerover', { bubbles: true })
        Object.defineProperty(touch, 'pointerType', { value: 'touch' })
        button.dispatchEvent(touch)
        await delay(270)
        assert.equal(document.querySelector('[role=tooltip]'), null)
        button.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }))
        await delay(270)
        assert.equal(document.querySelector('[role=tooltip]').hidden, false)
        button.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
        document.body.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true, relatedTarget: button }))
        await delay(120)
        assert.equal(document.querySelector('[role=tooltip]').hidden, true, 'leaving the target must dismiss the hover tooltip')
        button.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }))
        await delay(270)
        document.dispatchEvent(new window.Event('scroll'))
        assert.equal(document.querySelector('[role=tooltip]').hidden, true)
    } finally { cleanup(); button.remove() }
    assert.equal(document.querySelector('[role=tooltip]'), null)
})
