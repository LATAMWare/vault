import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

interface Envelope {
    v: 1
    iv: string
    tag: string
    data: string
}
export interface WrappedKey extends Envelope {
    keyId: string
}

export function encrypt(key: Buffer, plaintext: string, context: string): Envelope {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    cipher.setAAD(Buffer.from(context))
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    return {
        v: 1,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64")
    }
}

export function decrypt(key: Buffer, envelope: Envelope, context: string): string {
    if (envelope.v !== 1) throw new Error("Unsupported company encryption format")
    const iv = Buffer.from(envelope.iv, "base64"),
        tag = Buffer.from(envelope.tag, "base64")
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid company encryption envelope")
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")
}

export function wrapKey(key: Buffer, vaultId: string, keyId: string, wrappingKey: Buffer): string {
    return JSON.stringify({ ...encrypt(wrappingKey, key.toString("base64"), `vault-key:${vaultId}:v1`), keyId })
}

export function unwrapKey(value: string, vaultId: string, keys: Record<string, Buffer>): Buffer {
    const envelope = JSON.parse(value) as WrappedKey
    if (!keys[envelope.keyId]) throw new Error("A required company encryption key is missing")
    const key = Buffer.from(decrypt(keys[envelope.keyId], envelope, `vault-key:${vaultId}:v1`), "base64")
    if (key.length !== 32) throw new Error("Invalid vault encryption key")
    return key
}
