import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {setupBrowser} from './browser.mjs'

test('installable web app manifest has correctly sized icons and the original vault branding',()=>{
    const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url)))
    assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/')
    for(const icon of manifest.icons){const bytes=readFileSync(new URL('../public'+icon.src,import.meta.url));assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes)}
})
test('service worker never caches credential responses and only provides a generic offline navigation page',async()=>{
    const handlers={},saved=[],network=new Response('synthetic-sensitive-response-only')
    let offline=false
    runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{
        self:{addEventListener:(name,callback)=>{handlers[name]=callback},location:{origin:'https://vault.test'},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
        URL,Response,fetch:async()=>{if(offline)throw new Error('offline');return network},caches:{open:()=>{saved.push('unexpected-cache');throw new Error('must not cache')}}
    })
    let result=Promise.resolve(new Response())
    handlers.fetch({request:{url:'https://vault.test/',method:'GET',mode:'navigate'},respondWith:promise=>{result=promise}})
    assert.equal(await result,network)
    offline=true
    handlers.fetch({request:{url:'https://vault.test/private-sensitive-path',method:'GET',mode:'navigate'},respondWith:promise=>{result=promise}})
    const fallback=await result;assert.equal(fallback.status,503)
    const html=await fallback.text();assert.equal(html.includes('synthetic-sensitive-response'),false);assert.equal(html.includes('private-sensitive-path'),false)
    let intercepted=false
    for(const request of [{url:'https://vault.test/api/company',method:'GET',mode:'navigate'},{url:'https://other.test/',method:'GET',mode:'navigate'},{url:'https://vault.test/',method:'POST',mode:'navigate'}])handlers.fetch({request,respondWith:()=>{intercepted=true}})
    assert.equal(intercepted,false);assert.equal(saved.length,0)
})
test('install action uses the deferred browser prompt and registration never requests vault data',async()=>{
    setupBrowser();globalThis.IS_REACT_ACT_ENVIRONMENT=true
    window.isSecureContext=true
    const registrations=[]
    Object.defineProperty(navigator,'serviceWorker',{value:{register:async(...args)=>{registrations.push(args)}}})
    const {setupPwa}=await import('../src/logic/pwa.ts')
    setupPwa();window.dispatchEvent(new window.Event('load'))
    assert.equal(registrations[0][0],'/sw.js');assert.equal(registrations[0][1].updateViaCache,'none')
    const React=await import('react'),{createRoot}=await import('react-dom/client')
    const {default:InstallApp}=await import('../src/components/global/install-app.tsx')
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
    let prompted=false
    try{
        const event=new window.Event('beforeinstallprompt',{cancelable:true})
        event.prompt=async()=>{prompted=true;return{outcome:'accepted'}}
        window.dispatchEvent(event)
        assert.equal(event.defaultPrevented,true)
        await React.act(async()=>root.render(React.createElement(InstallApp)))
        await React.act(async()=>host.querySelector('button').click())
        assert.equal(prompted,true);assert.equal(host.querySelector('button'),null)
    }finally{await React.act(async()=>root.unmount());host.remove()}
})
