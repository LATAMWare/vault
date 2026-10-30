// Network-only worker: never stores authenticated pages, API responses or credentials.
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()) })
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)
    if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
    event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>LATAMWare Vault · Sin conexión</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1e1927;color:#eee7f7;font:16px/1.6 system-ui}main{max-width:30rem;padding:2rem}a{color:#cbb4ff}</style><main><h1>LATAMWare Vault</h1><p>Necesitás conexión para ingresar y consultar tus bóvedas.</p><p lang="en">An internet connection is required to access your vaults.</p><a href="/">Volver a intentar / Retry</a></main></html>`, {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive'}})))
})
