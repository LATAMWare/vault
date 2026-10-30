import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { upgradeAuditProof, verifyAuditProof } from '../src/server/audit-ots.ts'

try {
    const {values} = parseArgs({options:{receipt:{type:'string'}}})
    if (!values.receipt) throw new Error('Usage: pnpm company:audit:verify --receipt /absolute/path/receipt.json')
    const bytes = readFileSync(values.receipt)
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Receipt exceeds the size limit')
    const receipt = JSON.parse(bytes.toString('utf8'))
    if (receipt.format !== 'latamware-audit-proof-v1' || typeof receipt.manifest !== 'string' || typeof receipt.ots !== 'string') throw new Error('Invalid receipt')
    const digest = createHash('sha256').update(receipt.manifest).digest('hex')
    if (digest !== receipt.digest) throw new Error('Receipt fingerprint mismatch')
    const proof = await upgradeAuditProof(receipt.ots, digest)
    const result = await verifyAuditProof(proof, digest)
    if (result) console.log(`CONFIRMED: Bitcoin block ${result.height} (${result.hash}), ${new Date(result.time).toISOString()}. Checked via two public providers.`)
    else { console.log('PENDING: no Bitcoin attestation with six confirmations is available yet.'); process.exitCode = 2 }
} catch (reason) { console.error(reason instanceof Error ? reason.message : 'Verification failed'); process.exitCode = 1 }
