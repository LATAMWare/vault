import { t } from "@logic/i18n"
import randomseed from "random-seed"

export type PasswordAlgorithm = "legacy" | "pbkdf2-v2"
export const CURRENT_PASSWORD_ALGORITHM: PasswordAlgorithm = "pbkdf2-v2"
const ENCRYPTION_PREFIX = "vault:v2:"
export const KDF_ITERATIONS = 600000

export const generateId = () => {
    const cryptoApi = globalThis.crypto ?? (typeof window !== "undefined" ? window.crypto : undefined)
    if (!cryptoApi?.getRandomValues) throw new Error(t("Secure random generation is unavailable"))
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")
}

export const generateAccountId = (): string => {

    const cryptoApi = globalThis.crypto

    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID()
    }

    const hex = generateId()
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`
	
}

export const genServicePassword = async (
	master: string,
	identifier: string,
	length: number,
	alphabet: {
		identifier: string,
		characters: string
	},
	version = 1,
    algorithm: PasswordAlgorithm = "legacy"
): Promise<string> => {

    if(master == '' || identifier == '') return ''
    if (!Number.isInteger(length) || length < 1 || length > 1024) throw new Error(t("Password length must be between 1 and 1024"))
    if (!Number.isInteger(version) || version < 1 || version > 999) throw new Error(t("Invalid password version"))
    if (!alphabet?.identifier || !alphabet.characters) throw new Error(t("Select a valid alphabet"))
    if (algorithm === "pbkdf2-v2") return createSecurePassword(master, identifier, length, alphabet, version)
    if (algorithm !== "legacy") throw new Error(t("Unsupported password algorithm"))

	let versionHash = ''

	if(version && version > 1)
		versionHash = await createHash('version-' + version)

    const masterHash = await createHash(master)
    const identifierHash = await createHash(identifier)
    const alphabetHash = await createHash(alphabet.identifier)

	let appendHashes = masterHash + identifierHash + alphabetHash

	if(versionHash) appendHashes += versionHash

    const hash = await createHash(appendHashes)

	return await createPassword(hash, length, alphabet.characters)

}

// Versioned separately from password rotation, so existing passwords never change on upgrade.
const createSecurePassword = async (master: string, identifier: string, length: number, alphabet: { identifier: string, characters: string }, version: number) => {
    const cryptoApi = ensureCryptoAvailability()
    const encoder = new TextEncoder()
    const material = await cryptoApi.subtle.importKey("raw", encoder.encode(master), "PBKDF2", false, ["deriveKey"])
    const salt = encoder.encode(JSON.stringify(["latamware-vault-password-v2", identifier, alphabet.identifier, alphabet.characters, version]))
    const key = await cryptoApi.subtle.deriveKey({ name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" }, material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"])
    const characters = Array.from(alphabet.characters)
    if (characters.length > 65536) throw new Error(t("Alphabet is too large"))
    // Rejection sampling avoids modulo bias; HMAC expands the derived key deterministically.
    const limit = Math.floor(65536 / characters.length) * characters.length
    let result = "", count = 0, block = 0
    while (count < length) {
        const bytes = new DataView(await cryptoApi.subtle.sign("HMAC", key, encoder.encode(`password-block:${block++}`)))
        for (let offset = 0; offset < bytes.byteLength && count < length; offset += 2) {
            const value = bytes.getUint16(offset)
            if (value < limit) { result += characters[value % characters.length]; count++ }
        }
    }
    return result
}

const createPassword = async (hash: string, length: number, alphabet: string): Promise<string> => {

    const seed = randomseed.create(hash)

    let result = ''

    for(let i = 0; i < length; i++)
        result += alphabet[seed(alphabet.length)]

    return result
}

export const ensureCryptoAvailability = () => {
    const cryptoApi = globalThis.crypto ?? (typeof window !== "undefined" ? window.crypto : undefined)
    if (!cryptoApi || !cryptoApi.subtle) {
        const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : globalThis.isSecureContext === true
        const reason = isSecureContext
            ? t("Web Crypto was not initialized correctly")
            : t("This page is not running in a secure context. Use HTTPS or localhost.")

        throw new Error(t("Web Crypto is unavailable: {{value0}}", { value0: reason }))
    }
    return cryptoApi
}

const createHash = async (str: string): Promise<string> => {
    const cryptoApi = ensureCryptoAvailability()
    const buffer = await cryptoApi.subtle.digest("SHA-512", new TextEncoder().encode(str))
    return Array.prototype.map.call(new Uint8Array(buffer), x => (('00' + x.toString(16)).slice(-2))).join('')
}

export const copyToClipboard = (text: string) => {
    return navigator.clipboard.writeText(text)
}

export const downloadFile = (data: string, filename: string, type: string) => {
	
    var file = new Blob([data], { type: type })

	const a = document.createElement("a")
	const url = URL.createObjectURL(file)

	a.href = url
	a.download = filename

	document.body.appendChild(a)

	a.click()

	setTimeout(function() {
		document.body.removeChild(a)
		window.URL.revokeObjectURL(url); 
	}, 0)

}

const generateKey = async (masterKey: string, salt: BufferSource, iterations: number, length: number, hash: HashAlgorithmIdentifier, algorithm = 'AES-CBC'): Promise<CryptoKey> => {

	const cryptoApi = ensureCryptoAvailability()
	const encoder = new TextEncoder()

	const keyMaterial = await cryptoApi.subtle.importKey('raw', encoder.encode(masterKey), { name: 'PBKDF2' }, false, ['deriveKey'])

	return await cryptoApi.subtle.deriveKey({
		name: 'PBKDF2',
		salt,
		iterations,
		hash
	}, keyMaterial, {
		name: algorithm,
		length: length
	}, false, ['encrypt', 'decrypt'])

}

export const encodeData = async (masterKey: string, data: string) => {

	const cryptoApi = ensureCryptoAvailability()
	const encoder = new TextEncoder()

	const salt = cryptoApi.getRandomValues(new Uint8Array(16))
	const iv = cryptoApi.getRandomValues(new Uint8Array(12))
	const bufferData = encoder.encode(data)
	const key = await generateKey(masterKey, salt, KDF_ITERATIONS, 256, 'SHA-256', 'AES-GCM')

	const encodedData = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(ENCRYPTION_PREFIX) }, key, bufferData)

    const payload = new Uint8Array(salt.length + iv.length + encodedData.byteLength)
    payload.set(salt); payload.set(iv, salt.length); payload.set(new Uint8Array(encodedData), salt.length + iv.length)
	return ENCRYPTION_PREFIX + bufToBase64(payload.buffer)

}

export const decodeData = async (masterKey: string, data: string) => {

	const cryptoApi = ensureCryptoAvailability()
	const decoder = new TextDecoder()

    if (typeof data !== "string") throw new Error(t("Invalid encrypted data"))
    if (data.startsWith("vault:") && !data.startsWith(ENCRYPTION_PREFIX)) throw new Error(t("Unsupported encryption version"))
    const authenticated = data.startsWith(ENCRYPTION_PREFIX)
	const bufferData = base64ToBuf(authenticated ? data.slice(ENCRYPTION_PREFIX.length) : data)
    if (bufferData.byteLength < (authenticated ? 44 : 48)) throw new Error(t("Invalid encrypted data"))
	const salt = bufferData.slice(0, 16)
    const offset = authenticated ? 28 : 32
	const iv = bufferData.slice(16, offset)
	const key = await generateKey(masterKey, salt, authenticated ? KDF_ITERATIONS : 100000, 256, 'SHA-256', authenticated ? 'AES-GCM' : 'AES-CBC')

	const decodeDataBuffer = await cryptoApi.subtle.decrypt(authenticated
        ? { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(ENCRYPTION_PREFIX) }
        : { name: "AES-CBC", iv }, key, bufferData.slice(offset))

	return decoder.decode(decodeDataBuffer)

}

export const bufToBase64 = (b: ArrayBuffer) => {
    const bytes = new Uint8Array(b)
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
    return btoa(chunks.join(""))
}
export const base64ToBuf = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer

export const randomBytes = (len = 16) => {
	const cryptoApi = ensureCryptoAvailability()
	const b = new Uint8Array(len)
	cryptoApi.getRandomValues(b)
	return b.buffer
}

export const deriveHmacKey = async (password: string, salt: ArrayBuffer, iterations = KDF_ITERATIONS) => {
	const cryptoApi = ensureCryptoAvailability()
	const enc = new TextEncoder()
	const baseKey = await cryptoApi.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey'])
	const key = await cryptoApi.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
		baseKey,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	)
	return key
}

export const equalArrayBuffers = (a: ArrayBuffer, b: ArrayBuffer) => {
	if (a.byteLength !== b.byteLength) return false
	const aa = new Uint8Array(a)
	const bb = new Uint8Array(b)
	let diff = 0
	for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i]
	return diff === 0
}

export const normalizeHex = (defaultColor: string, color: string) => {
    if (!color || typeof color !== "string") return defaultColor
    const trimmed = color.trim()
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
        return `#${trimmed.slice(1).split("").map((value) => value + value).join("")}`.toUpperCase()
    }
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase()
    return defaultColor
}

export const hexToRgb = (defaultColor: string, hex: string) => {
    const normalized = normalizeHex(defaultColor, hex)
    const raw = normalized.replace("#", "")
    return {
        r: Number.parseInt(raw.slice(0, 2), 16),
        g: Number.parseInt(raw.slice(2, 4), 16),
        b: Number.parseInt(raw.slice(4, 6), 16)
    }
}

export const rgbToHex = ({ r, g, b }: { r: number, g: number, b: number }) => {
    const toHex = (value: number) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

export const mixWithWhite = (defaultColor: string, hex: string, percentage = 0.2) => {
    const { r, g, b } = hexToRgb(defaultColor, hex)
    const ratio = 1 - percentage
    return rgbToHex({
        r: Math.round(r * ratio + 255 * percentage),
        g: Math.round(g * ratio + 255 * percentage),
        b: Math.round(b * ratio + 255 * percentage)
    })
}

export const buildMasterSeedBlocks = async (masterPassword: string) => {
    if (!masterPassword) return []

    const cryptoApi = globalThis.crypto ?? (typeof window !== "undefined" ? window.crypto : undefined)
    if (!cryptoApi || !cryptoApi.subtle) return []

    const hashBuffer = await cryptoApi.subtle.digest("SHA-512", new TextEncoder().encode(masterPassword))
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("")

    const blocks: Array<{ id: number, seed: string, color: { r: number, g: number, b: number }, token: string }> = []
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    for (let index = 0; index < 4; index++) {
        const seed = hashHex.slice(index * 32, (index + 1) * 32) || "00000000000000000000000000000000"
        const color = {
            r: Number.parseInt(seed.slice(0, 2), 16),
            g: Number.parseInt(seed.slice(2, 4), 16),
            b: Number.parseInt(seed.slice(4, 6), 16)
        }
        const numericSeed = Array.from(seed).reduce((total, char, charIndex) => total + char.charCodeAt(0) * (charIndex + 1), 0)
        const first = alphabet[numericSeed % alphabet.length]
        const second = alphabet[Math.floor(numericSeed / 13) % alphabet.length]

        blocks.push({
            id: index + 1,
            seed,
            color,
            token: `${first}${second}`
        })
    }

    return blocks
}
