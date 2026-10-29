// Isolated browser QA fixture. Never shipped by Docker and never uses real OAuth, keys or data.
import { CompanyStore } from '../src/server/company-store.ts'
import { encode } from '@auth/core/jwt'
import { parseAccessPolicy } from '../src/server/access-policy.ts'
import { createServer } from 'node:http'
import { createServer as createSocket } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = mkdtempSync(join(tmpdir(), 'latamware-company-preview-'))
const settings = { path: join(root, 'preview.sqlite'), keys: { v1: randomBytes(32) }, activeKey: 'v1', admins: ['admin@latamware.test'] }
const store = new CompanyStore(settings)
const admin = store.authenticate({ id: 'preview-admin', email: 'admin@latamware.test' }, Date.now())
const reader = store.authenticate({ id: 'preview-reader', email: 'equipo@latamware.test' }, Date.now())
const infra = store.createVault(admin, 'Infraestructura')
const clients = store.createVault(admin, 'Clientes')
const defaults = { kind: 'password', username: 'admin@empresa.test', password: 'Synthetic-demo-only-123!', url: 'https://example.test', notes: 'Datos de demostración. No corresponden a cuentas reales.' }
for (const title of ['Google Workspace', 'Panel de hosting', 'Servidor de producción']) store.saveItem(admin, infra.id, { ...defaults, title })
store.saveItem(admin, infra.id, { ...defaults, kind: 'note', title: 'Procedimiento de acceso', notes: 'Nota de demostración para el equipo.' })
store.saveItem(admin, clients.id, { ...defaults, title: 'Portal de clientes' })
store.share(admin, infra.id, reader.email, 'reader', parseAccessPolicy('latamware.test', ''))
store.share(admin, clients.id, reader.email, 'editor', parseAccessPolicy('latamware.test', ''))
store.close()
const socket = createSocket().listen(0, '127.0.0.1')
await once(socket, 'listening')
const backendPort = socket.address().port
await new Promise(resolve => socket.close(resolve))
const port = Number(process.env.VAULT_PREVIEW_PORT ?? 4323)
const origin = `http://localhost:${port}`
const secret = randomBytes(48).toString('base64')
const child = spawn(process.execPath, ['dist/server/entry.mjs'], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(backendPort), VAULT_AUTH_MODE: 'google', VAULT_AUTH_ORIGIN: origin,
    AUTH_SECRET: secret, GOOGLE_AUTH_CLIENT_ID: 'synthetic-preview', GOOGLE_AUTH_CLIENT_SECRET: 'synthetic-preview',
    VAULT_ALLOWED_DOMAINS: 'latamware.test', VAULT_ALLOWED_EMAILS: '', VAULT_ADMIN_EMAILS: settings.admins.join(','),
    VAULT_DATABASE_PATH: settings.path, VAULT_ENCRYPTION_KEYS: JSON.stringify({ v1: settings.keys.v1.toString('base64') }), VAULT_ACTIVE_KEY_ID: 'v1'
} })
for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`http://127.0.0.1:${backendPort}/api/health`); break } catch { await delay(100) }
}
const proxy = createServer(async (request, response) => {
    try {
        if (request.url === '/preview/admin' || request.url === '/preview/reader') {
            const identity = request.url.endsWith('reader') ? reader : admin
            const token = await encode({ secret, salt: 'authjs.session-token', maxAge: 3600, token: {
                vaultIdentity: { sub: identity.id, email: identity.email, email_verified: true, hd: 'latamware.test' }, vaultAuthenticatedAt: Date.now() / 1000
            } })
            response.writeHead(302, { 'Set-Cookie': `authjs.session-token=${token}; HttpOnly; SameSite=Lax; Path=/`, Location: '/' }); response.end(); return
        }
        const upstream = await fetch(`http://127.0.0.1:${backendPort}${request.url}`, {
            method: request.method, headers: request.headers, redirect: 'manual',
            ...(!['GET', 'HEAD'].includes(request.method) ? { body: request, duplex: 'half' } : {})
        })
        response.statusCode = upstream.status
        for (const [key, value] of upstream.headers) if (!['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) response.setHeader(key, value)
        if (upstream.headers.getSetCookie().length) response.setHeader('Set-Cookie', upstream.headers.getSetCookie())
        response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { response.writeHead(502); response.end('Preview unavailable') }
})
proxy.listen(port, '127.0.0.1')
await once(proxy, 'listening')
console.log(`Synthetic UI preview: ${origin}/preview/admin`)
let stopping = false
async function stop() {
    if (stopping) return
    stopping = true
    proxy.closeAllConnections(); proxy.close()
    const ended = once(child, 'exit'); child.kill(); await ended
    if (dirname(realpathSync(root)) !== realpathSync(tmpdir()) || !basename(root).startsWith('latamware-company-preview-')) throw new Error('Unexpected preview directory')
    rmSync(root, { recursive: true, force: true })
    process.exit(0)
}
process.on('SIGINT', () => { void stop() }); process.on('SIGTERM', () => { void stop() })
