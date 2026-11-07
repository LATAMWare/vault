import assert from 'node:assert/strict'
import test from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {setupBrowser} from './browser.mjs'
setupBrowser();globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react'),{createRoot}=await import('react-dom/client')
const {setLanguage,t}=await import('../src/logic/i18n.ts')
const {default:ActivityFeed}=await import('../src/components/company/activity-feed.tsx')
const {default:AuditIntegrity}=await import('../src/components/company/audit-integrity.tsx')
async function mounted(Component,fetcher,check){
    const original=globalThis.fetch;globalThis.fetch=fetcher
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
    try{await setLanguage('es',false);await React.act(async()=>root.render(React.createElement(Component)));await check(host)}
    finally{await React.act(async()=>root.unmount());host.remove();globalThis.fetch=original;await setLanguage('en',false)}
}
const entry=(id,target)=>({id,action:'item.updated',actor:'fixture@latamware.test',target,createdAt:Date.now()})
test('history arrows replace the page, action dropdown filters, and typing applies search without a submit button',async()=>{
    const requests=[]
    await mounted(ActivityFeed,async path=>{
        const url=new URL(path,'https://vault.test');requests.push(url)
        const page=Number(url.searchParams.get('page')??1),filtered=Boolean(url.searchParams.get('action')||url.searchParams.get('q'))
        return Response.json({entries:filtered?[entry(9,'Filtered item')]:page===1?[entry(3,'First page item'),entry(2,'Another item')]:[entry(1,'Older page item')],total:filtered?1:3,page:filtered?1:page,pages:filtered?1:2,asOf:3})
    },async host=>{
        assert.equal(host.querySelector('select'),null)
        assert.equal(host.textContent.includes('últimos 200'),false)
        await React.act(async()=>host.querySelector('button[aria-label="Página siguiente"]').click())
        assert.ok(host.textContent.includes('Older page item'))
        assert.equal(host.textContent.includes('First page item'),false)
        assert.equal(host.querySelectorAll('tbody tr').length,1)
        assert.equal(requests.at(-1).searchParams.get('asOf'),'3')
        await React.act(async()=>host.querySelector('summary').click())
        const option=[...host.querySelectorAll('[role=option]')].find(button=>button.textContent.includes(t('Item updated')))
        await React.act(async()=>option.click())
        assert.equal(requests.at(-1).searchParams.get('action'),'item.updated')
        assert.ok(host.textContent.includes('Filtered item'))
        assert.equal(host.querySelector('button[aria-label="Página anterior"]').disabled,true)
        const input=host.querySelector('input[type=search]')
        await React.act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'fixture');input.dispatchEvent(new window.Event('input',{bubbles:true}))})
        await React.act(async()=>delay(280))
        assert.equal(requests.at(-1).searchParams.get('q'),'fixture')
    })
})
test('seal panel exposes exactly four controls, accessible pending text and an explorer link only when confirmed',async()=>{
    let confirmed=false
    const block='000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319'
    await mounted(AuditIntegrity,async(_path,options)=>{
        if(options.method==='POST')confirmed=true
        return Response.json({integrity:'intact',unsealedCount:0,batches:[{id:'fixture-seal',integrity:'intact',state:confirmed?'confirmed':'pending',blockHash:confirmed?block:null}]})
    },async host=>{
        assert.equal(host.querySelectorAll('.cw-integrity-actions button,.cw-integrity-actions a').length,4)
        assert.ok(host.textContent.includes('Pendiente de verificación'))
        assert.equal(host.querySelector('details'),null)
        assert.equal(host.querySelector('code'),null)
        assert.equal(host.querySelector('a'),null)
        assert.equal([...host.querySelectorAll('button')].find(button=>button.textContent==='Sellar actividad').disabled,true)
        const verify=[...host.querySelectorAll('button')].find(button=>button.textContent==='Verificar integridad')
        await React.act(async()=>verify.click())
        assert.equal(host.querySelector('a').href,`https://mempool.space/block/${block}`)
        assert.equal(host.querySelector('a').rel,'noopener noreferrer')
        assert.ok(host.querySelector('.cw-integrity-result').textContent.includes('El sello está confirmado en Bitcoin.'))
    })
})

test('verifying visibly reports progress, a successful local check with pending Bitcoin, and provider errors',async()=>{
    let finish
    const overview={integrity:'intact',unsealedCount:0,batches:[{id:'fixture-seal',integrity:'intact',state:'pending',blockHash:null}]}
    await mounted(AuditIntegrity,async(_path,options)=>options.method==='POST'?new Promise(resolve=>{finish=resolve}):Response.json(overview),async host=>{
        const verify=[...host.querySelectorAll('button')].find(button=>button.textContent==='Verificar integridad')
        await React.act(async()=>verify.click())
        assert.equal(verify.textContent,'Verificando integridad...')
        assert.equal(verify.disabled,true)
        await React.act(async()=>finish(Response.json(overview)))
        assert.ok(host.querySelector('.cw-integrity-result').textContent.includes('La actividad está intacta.'))
        assert.ok(host.querySelector('.cw-integrity-result').textContent.includes('sigue pendiente'))
        await React.act(async()=>verify.click())
        assert.equal(host.querySelector('.cw-integrity-result'),null,'a previous success cannot mask a failed recheck')
        await React.act(async()=>finish(Response.json({error:'Bitcoin verification could not be completed. No new confirmation was recorded.'},{status:503})))
        assert.ok(host.querySelector('[role=alert]').textContent.length>0)
        assert.equal(host.querySelector('.cw-integrity-result'),null)
        assert.equal(verify.disabled,false)
    })
})
