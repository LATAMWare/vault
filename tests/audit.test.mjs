import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { newTree, write } from '@vitrified/typescript-opentimestamps'
import { AuditLedger, hash } from '../src/server/audit-ledger.ts'
import { CompanyStore, CompanyError } from '../src/server/company-store.ts'
import { parseAccessPolicy } from '../src/server/access-policy.ts'
import { submitAuditDigest, verifyAuditProof, upgradeAuditProof, readAuditProof } from '../src/server/audit-ots.ts'
import { runAuditWorkerOnce } from '../src/server/audit-worker.ts'

const block = JSON.parse(readFileSync(new URL('./fixtures/ots/bitcoin-block.json', import.meta.url)))
const known = readFileSync(new URL('./fixtures/ots/hello-world.txt.ots', import.meta.url)).toString('base64')
const pending = digest => { const tree=newTree(); tree.leaves.add({type:'pending',url:new URL('https://alice.btc.calendar.opentimestamps.org')}); return Buffer.from(write({version:1,fileHash:{algorithm:'sha256',value:Buffer.from(digest,'hex')},tree})).toString('base64') }
function fixture(t) {
    const root=mkdtempSync(join(tmpdir(),'latamware-audit-test-'))
    const store=new CompanyStore({path:join(root,'db.sqlite'),keys:{v1:randomBytes(32)},activeKey:'v1',admins:['admin@latamware.test']})
    t.after(()=>{store.close();assert.equal(dirname(realpathSync(root)),realpathSync(tmpdir()));rmSync(root,{recursive:true,force:true})})
    const admin=store.authenticate({id:'admin',email:'admin@latamware.test'},Date.now())
    const reader=store.authenticate({id:'reader',email:'reader@latamware.test'},Date.now())
    const vault=store.createVault(admin,'Synthetic shared vault')
    store.share(admin,vault.id,reader.email,'reader',parseAccessPolicy('latamware.test',''))
    return {store,admin,reader,vault,ledger:new AuditLedger(store)}
}
test('audit seals bind complete raw records, preserve old names and exclude identities/content from exported manifests',t=>{
    const {store,admin,reader,vault,ledger}=fixture(t)
    const seal=ledger.prepare(admin,vault.id)
    assert.equal(ledger.list(admin,vault.id).integrity,'intact')
    for(const value of [admin.email,reader.email,vault.name])assert.equal(seal.manifest.includes(value),false)
    assert.equal(hash(seal.manifest),seal.digest)
    assert.equal(ledger.prepare(admin,vault.id).id,seal.id,'retry preserves the original pending seal')
    ledger.saveProof(admin,seal.id,pending(seal.digest),vault.id)
    assert.equal(ledger.list(admin,vault.id).batches[0].state,'pending')
    store.renameVault(admin,vault.id,'Renamed vault',store.getVault(admin,vault.id).version)
    assert.equal(ledger.list(admin,vault.id).integrity,'intact')
    assert.equal(ledger.list(admin,vault.id).unsealedCount,1)
    assert.throws(()=>ledger.list(reader,vault.id),error=>error instanceof CompanyError&&error.status===403)
    assert.throws(()=>ledger.list(reader),error=>error instanceof CompanyError&&error.status===403)
    const oldest=JSON.parse(seal.manifest).events[0][0]
    store.db.prepare('UPDATE company_audit SET target=? WHERE id=?').run('forged',oldest)
    assert.equal(ledger.list(admin,vault.id).integrity,'changed')
    assert.throws(()=>ledger.prepare(admin,vault.id),error=>error.status===409)
    assert.throws(()=>ledger.download(admin,seal.id,vault.id),error=>error.status===409)
})
test('deleted events, modified proofs and malformed seal manifests are reported as changed',t=>{
    const {store,admin,vault,ledger}=fixture(t)
    const seal=ledger.prepare(admin,vault.id)
    const original=store.db.prepare('SELECT * FROM company_audit WHERE id=?').get(seal.first_id)
    store.db.prepare('DELETE FROM company_audit WHERE id=?').run(seal.first_id)
    assert.equal(ledger.list(admin,vault.id).integrity,'changed')
    store.db.prepare('INSERT INTO company_audit(id,vault_id,actor_id,actor_email,action,target,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(original))
    store.db.prepare('UPDATE company_audit_seals SET proof=? WHERE id=?').run(pending('11'.repeat(32)),seal.id)
    assert.equal(ledger.list(admin,vault.id).integrity,'changed')
    store.db.prepare('UPDATE company_audit_seals SET manifest=? WHERE id=?').run('{broken',seal.id)
    assert.equal(ledger.list(admin,vault.id).batches[0].integrity,'changed')
})
test('automatic worker seals aged events without user action, reuses pending receipts and does not seal unchanged history',async t=>{
    const {store,admin,vault,ledger}=fixture(t)
    store.db.prepare('UPDATE company_audit SET created_at=?').run(Date.now()-600000)
    let submissions=0
    const transport={submit:async digest=>{submissions++;return pending(digest)},upgrade:async proof=>proof,verify:async()=>undefined}
    const first=await runAuditWorkerOnce(store,Date.now(),transport)
    assert.ok(first.submitted>=2)
    assert.equal(ledger.list(admin,vault.id).batches[0].state,'pending')
    assert.equal(ledger.list(admin).batches[0].state,'pending')
    const count=submissions
    await runAuditWorkerOnce(store,Date.now(),transport)
    assert.equal(submissions,count)
    assert.equal(ledger.list(admin,vault.id).unsealedCount,0)
})
test('activity pagination exposes all older events, filters safely and denies readers',t=>{
    const {store,admin,reader,vault}=fixture(t)
    store.db.exec('BEGIN')
    for(let index=0;index<235;index++)store.db.prepare('INSERT INTO company_audit(vault_id,actor_id,actor_email,action,target,created_at) VALUES(?,?,?,?,?,?)').run(vault.id,'fixture',`user-${index%3}@latamware.test`,'item.updated',`Item ${index}`,Date.now())
    store.db.exec('COMMIT')
    let page=store.getAuditPage(admin,new URLSearchParams(),vault.id), ids=page.entries.map(entry=>entry.id)
    assert.equal(page.entries.length,100)
    const total=page.total
    const snapshot=page.asOf;for(let number=2;number<=page.pages;number++){page=store.getAuditPage(admin,new URLSearchParams({page:String(number),asOf:String(snapshot)}),vault.id);ids.push(...page.entries.map(entry=>entry.id))}
    assert.equal(ids.length,total);assert.equal(new Set(ids).size,total);assert.ok(total>200)
    assert.equal(store.getAuditPage(admin,new URLSearchParams({q:'user-2@',action:'item.updated'}),vault.id).total,78)
    assert.throws(()=>store.getAuditPage(reader,new URLSearchParams(),vault.id),error=>error.status===403)
    assert.throws(()=>store.getAuditPage(admin,new URLSearchParams({page:'NaN'})),error=>error.status===400)
})
test('public timestamp submission sends only randomized 32-byte commitments and returns interoperable pending receipts',async()=>{
    const digest=hash('Synthetic audit hash only'), sent=[]
    const fetcher=async(url,options)=>{
        assert.equal(options.redirect,'error')
        sent.push({url,body:Buffer.from(options.body)})
        const tree=newTree();tree.leaves.add({type:'pending',url:new URL(new URL(url).origin)})
        const receipt=Buffer.from(write({version:1,fileHash:{algorithm:'sha256',value:new Uint8Array(32)},tree}))
        return new Response(receipt.subarray(65))
    }
    const proof=await submitAuditDigest(digest,fetcher)
    assert.equal(readAuditProof(proof,digest).fileHash.algorithm,'sha256')
    assert.equal(sent.length,2)
    assert.ok(sent.every(request=>request.body.length===32&&request.body.toString('hex')!==digest))
    assert.equal(await verifyAuditProof(proof,digest,()=>{throw new Error('pending must not query Bitcoin yet')}),undefined)
    await assert.rejects(submitAuditDigest(digest,async()=>new Response('',{status:503})))
})
test('known Bitcoin proofs require matching headers and at least six confirmations from both providers',async()=>{
    const fetcher=async url=>{
        if(url.includes('/block-height/'))return new Response(block.hash)
        if(url.endsWith('/blocks/tip/height'))return new Response(String(block.height+5))
        if(url.endsWith('/header'))return new Response(block.header)
        throw new Error('Unexpected verifier request')
    }
    const result=await verifyAuditProof(known,block.digest,fetcher)
    assert.equal(result.height,block.height);assert.equal(result.hash,block.hash)
    const unconfirmed=async url=>url.endsWith('/blocks/tip/height')?new Response(String(block.height+4)):fetcher(url)
    assert.equal(await verifyAuditProof(known,block.digest,unconfirmed),undefined)
    await assert.rejects(verifyAuditProof(known,block.digest,async url=>url.endsWith('/header')?new Response('00'.repeat(80)):fetcher(url)))
    await assert.rejects(verifyAuditProof(known,'00'.repeat(32),fetcher))
    await assert.rejects(verifyAuditProof(known,block.digest,async()=>{throw new Error('offline')}))
})
test('untrusted calendar URLs and redirects cannot select arbitrary network targets',async()=>{
    const digest=hash('synthetic'),tree=newTree()
    tree.leaves.add({type:'pending',url:new URL('http://127.0.0.1:4321')})
    const proof=Buffer.from(write({version:1,fileHash:{algorithm:'sha256',value:Buffer.from(digest,'hex')},tree})).toString('base64')
    let requests=0
    await assert.rejects(upgradeAuditProof(proof,digest,async()=>{requests++;throw new Error('must not fetch')}))
    const other=newTree();other.leaves.add({type:'pending',url:new URL('https://calendar.attacker.test')})
    const unknown=Buffer.from(write({version:1,fileHash:{algorithm:'sha256',value:Buffer.from(digest,'hex')},tree:other})).toString('base64')
    await upgradeAuditProof(unknown,digest,async()=>{requests++;throw new Error('must not fetch')})
    assert.equal(requests,0)
})

test('real calendar receipts with 44-byte intermediate commitments upgrade and verify against both Bitcoin providers',async()=>{
    const initial=JSON.parse(readFileSync(new URL('./fixtures/ots/live-pending.json',import.meta.url)))
    const fixture=JSON.parse(readFileSync(new URL('./fixtures/ots/calendar-upgrade.json',import.meta.url)))
    const fetcher=async url=>{
        const saved=fixture.responses.find(response=>response.url===url)
        assert.ok(saved,`unexpected external request: ${url}`)
        if(url.includes('/timestamp/'))assert.equal(url.split('/').at(-1).length,88,'calendar commitment is 44 bytes')
        return new Response(Buffer.from(saved.body,'base64'),{status:saved.status})
    }
    const upgraded=await upgradeAuditProof(initial.proof,initial.digest,fetcher)
    assert.notEqual(upgraded,initial.proof)
    const confirmation=await verifyAuditProof(upgraded,initial.digest,fetcher)
    assert.equal(confirmation.height,fixture.confirmation.height)
    assert.equal(confirmation.hash,fixture.confirmation.hash)
})

test('calendar outages and malformed upgrade replies are errors, while an explicit not-ready response remains pending',async()=>{
    const digest=hash('Synthetic outage test'),proof=pending(digest)
    await assert.rejects(upgradeAuditProof(proof,digest,async()=>{throw new Error('offline')}))
    await assert.rejects(upgradeAuditProof(proof,digest,async()=>new Response('',{status:503})))
    await assert.rejects(upgradeAuditProof(proof,digest,async()=>new Response('not an OTS tree')))
    assert.equal(await upgradeAuditProof(proof,digest,async()=>new Response('',{status:404})),proof)
    assert.equal(readAuditProof(proof,digest).fileHash.algorithm,'sha256','original receipt remains usable')
})
