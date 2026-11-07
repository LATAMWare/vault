import { createHash, randomBytes } from "node:crypto"
import {
    newTree,
    read,
    write,
    type Timestamp,
    type Tree,
    type Op,
    type Leaf
} from "@vitrified/typescript-opentimestamps"

export const CALENDARS = [
    "https://alice.btc.calendar.opentimestamps.org",
    "https://bob.btc.calendar.opentimestamps.org"
] as const
export const EXPLORERS = ["https://blockstream.info/api", "https://mempool.space/api"] as const
const HEADER = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e892940108", "hex")
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest()
type Fetcher = typeof fetch
type Point = { tree: Tree; leaf: Leaf; message: Buffer }
class TimestampServiceError extends Error {
    constructor(readonly status: number) {
        super("Timestamp service unavailable")
    }
}

async function request(url: string, options: RequestInit = {}, fetcher: Fetcher = fetch): Promise<Buffer> {
    const response = await fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(7000),
        headers: { Accept: "application/vnd.opentimestamps.v1", ...options.headers }
    })
    if (!response.ok) throw new TimestampServiceError(response.status)
    const reader = response.body?.getReader()
    if (!reader) throw new Error("Invalid timestamp response")
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 65536) {
            await reader.cancel()
            throw new Error("Timestamp response is too large")
        }
        chunks.push(value)
    }
    return Buffer.concat(chunks)
}
function apply(op: Op, message: Buffer): Buffer {
    let result: Buffer
    switch (op.type) {
        case "sha256":
        case "sha1":
        case "ripemd160":
            result = createHash(op.type).update(message).digest()
            break
        case "append":
            result = Buffer.concat([message, op.operand])
            break
        case "prepend":
            result = Buffer.concat([op.operand, message])
            break
        case "reverse":
            result = Buffer.from(message).reverse()
            break
        case "hexlify":
            result = Buffer.from(message.toString("hex"))
            break
        default:
            throw new Error("Unsupported timestamp operation")
    }
    if (result.length > 32768) throw new Error("Invalid timestamp operation size")
    return result
}
function points(timestamp: Timestamp): Point[] {
    const result: Point[] = []
    let count = 0
    const visit = (tree: Tree, message: Buffer, depth: number) => {
        if (++count > 1024 || depth > 128) throw new Error("Timestamp proof is too complex")
        for (const leaf of tree.leaves.values()) result.push({ tree, message, leaf })
        for (const [op, child] of tree.edges.entries()) visit(child, apply(op, message), depth + 1)
    }
    visit(timestamp.tree, Buffer.from(timestamp.fileHash.value), 0)
    if (result.length > 64) throw new Error("Too many timestamp attestations")
    return result
}
export function readAuditProof(proof: string, digest: string) {
    const bytes = Buffer.from(proof, "base64")
    if (!/^[a-f0-9]{64}$/.test(digest) || bytes.length > 65536 || bytes.toString("base64") !== proof)
        throw new Error("Invalid timestamp proof")
    const timestamp = read(new Uint8Array(bytes))
    if (timestamp.fileHash.algorithm !== "sha256" || Buffer.from(timestamp.fileHash.value).toString("hex") !== digest)
        throw new Error("Timestamp fingerprint mismatch")
    points(timestamp)
    return timestamp
}
function calendarTree(body: Buffer) {
    // Calendar responses contain only a tree, not a detached file hash. Supply a
    // fixed-size placeholder to the detached-file codec; intermediate commitments
    // have variable lengths after appending/hash operations. Proof operations
    // still use the actual message rather than this parsing placeholder.
    return read(new Uint8Array(Buffer.concat([HEADER, Buffer.alloc(32), body]))).tree
}
function allowedCalendar(url: URL): string | undefined {
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return
    return CALENDARS.find((calendar) => url.origin === calendar)
}
export async function submitAuditDigest(digest: string, fetcher: Fetcher = fetch): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid audit digest")
    const nonce = randomBytes(32),
        commitment = sha(Buffer.concat([Buffer.from(digest, "hex"), nonce]))
    const received = await Promise.allSettled(
        CALENDARS.map(async (calendar) => {
            const body = await request(
                `${calendar}/digest`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/octet-stream" },
                    body: new Uint8Array(commitment)
                },
                fetcher
            )
            const tree = calendarTree(body)
            const attestations = points({ version: 1, fileHash: { algorithm: "sha256", value: commitment }, tree })
            if (
                !attestations.some(
                    (point) =>
                        point.leaf.type === "bitcoin" ||
                        (point.leaf.type === "pending" && allowedCalendar(point.leaf.url))
                )
            )
                throw new Error("No supported timestamp attestation")
            return tree
        })
    )
    const merged = newTree()
    let accepted = 0
    for (const entry of received)
        if (entry.status === "fulfilled") {
            merged.leaves.incorporate(entry.value.leaves)
            merged.edges.incorporate(entry.value.edges)
            accepted++
        }
    if (!accepted || (!merged.leaves.size() && !merged.edges.size()))
        throw new Error("Timestamp calendars are unavailable")
    const root = newTree(),
        hashed = newTree()
    root.edges.add({ type: "append", operand: nonce }, hashed)
    hashed.edges.add({ type: "sha256" }, merged)
    const proof = Buffer.from(
        write({ version: 1, fileHash: { algorithm: "sha256", value: Buffer.from(digest, "hex") }, tree: root })
    ).toString("base64")
    readAuditProof(proof, digest)
    return proof
}
export async function upgradeAuditProof(proof: string, digest: string, fetcher: Fetcher = fetch): Promise<string> {
    const timestamp = readAuditProof(proof, digest)
    const attestations = points(timestamp)
    const pending = attestations
        .filter((point) => point.leaf.type === "pending" && allowedCalendar(point.leaf.url))
        .slice(0, 4)
    let reachable = 0
    await Promise.all(
        pending.map(async (point) => {
            if (point.leaf.type !== "pending") return
            try {
                const calendar = allowedCalendar(point.leaf.url)!
                const body = await request(`${calendar}/timestamp/${point.message.toString("hex")}`, {}, fetcher)
                const tree = calendarTree(body)
                points({ version: 1, fileHash: { algorithm: "sha256", value: point.message }, tree })
                point.tree.leaves.remove(point.leaf)
                point.tree.leaves.incorporate(tree.leaves)
                point.tree.edges.incorporate(tree.edges)
                reachable++
            } catch (error) {
                // Calendars return 404 until an attestation is available. Outages
                // and malformed replies must not masquerade as a successful check.
                if (error instanceof TimestampServiceError && error.status === 404) reachable++
            }
        })
    )
    if (pending.length && !reachable && !attestations.some((point) => point.leaf.type === "bitcoin"))
        throw new Error("Timestamp calendars are unavailable")
    const upgraded = Buffer.from(write(timestamp)).toString("base64")
    readAuditProof(upgraded, digest)
    return upgraded
}
export async function verifyAuditProof(proof: string, digest: string, fetcher: Fetcher = fetch) {
    const leaves = points(readAuditProof(proof, digest))
        .filter((point) => point.leaf.type === "bitcoin")
        .slice(0, 2)
    for (const point of leaves) {
        if (point.leaf.type !== "bitcoin" || !Number.isSafeInteger(point.leaf.height) || point.leaf.height < 1)
            throw new Error("Invalid Bitcoin attestation")
        const height = point.leaf.height
        const results = await Promise.all(
            EXPLORERS.map(async (base) => {
                const [blockHash, tip] = await Promise.all([
                    request(`${base}/block-height/${height}`, {}, fetcher).then((bytes) => bytes.toString().trim()),
                    request(`${base}/blocks/tip/height`, {}, fetcher).then((bytes) => Number(bytes.toString()))
                ])
                if (!/^[a-f0-9]{64}$/.test(blockHash) || !Number.isSafeInteger(tip))
                    throw new Error("Invalid Bitcoin response")
                const raw = (await request(`${base}/block/${blockHash}/header`, {}, fetcher)).toString().trim()
                if (!/^[a-f0-9]{160}$/.test(raw)) throw new Error("Invalid Bitcoin header")
                const header = Buffer.from(raw, "hex")
                if (
                    sha(sha(header)).reverse().toString("hex") !== blockHash ||
                    !header.subarray(36, 68).equals(point.message)
                )
                    throw new Error("Bitcoin proof does not match the block")
                return {
                    hash: blockHash,
                    height,
                    time: header.readUInt32LE(68) * 1000,
                    confirmations: tip - height + 1
                }
            })
        )
        if (results[0].hash !== results[1].hash || results[0].time !== results[1].time)
            throw new Error("Bitcoin providers disagree")
        if (results.every((result) => result.confirmations >= 6)) return results[0]
    }
    return undefined
}
