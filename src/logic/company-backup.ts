import { decodeData, encodeData } from "./utils"
import { t, type Language } from "./i18n"

export const BACKUP_LIMIT = 6 * 1024 * 1024
const invalid = () => new Error(t("Invalid backup. No data was imported."))

export interface CompanyBackup {
    format: "latamware-company-backup"
    version: 1
    sourceId: string
    exportedAt: string
    vaults: {
        name: string
        items: {
            kind: "password" | "note"
            title: string
            username: string
            password: string
            url: string
            notes: string
        }[]
    }[]
    preferences?: { language: Language }
}

export function validateCompanyBackup(value: any): CompanyBackup {
    if (
        !value ||
        value.format !== "latamware-company-backup" ||
        value.version !== 1 ||
        typeof value.sourceId !== "string" ||
        !value.sourceId ||
        value.sourceId.length > 256 ||
        typeof value.exportedAt !== "string" ||
        !Array.isArray(value.vaults) ||
        !value.vaults.length ||
        value.vaults.length > 200
    )
        throw invalid()
    const vaults = value.vaults.map((vault: any) => {
        if (
            typeof vault?.name !== "string" ||
            !vault.name.trim() ||
            vault.name.length > 160 ||
            !Array.isArray(vault.items) ||
            vault.items.length > 5000
        )
            throw invalid()
        const items = vault.items.map((item: any) => {
            if (!item || !["password", "note"].includes(item.kind)) throw invalid()
            const limits = {
                title: 200,
                username: 1000,
                password: 16384,
                url: 2048,
                notes: 131072
            }
            for (const [key, length] of Object.entries(limits))
                if (typeof item[key] !== "string" || item[key].length > length) throw invalid()
            if (!item.title.trim() || !(item.kind === "password" ? item.password : item.notes).trim()) throw invalid()
            return {
                kind: item.kind,
                title: item.title,
                username: item.username,
                password: item.password,
                url: item.url,
                notes: item.notes
            }
        })
        return { name: vault.name, items }
    })
    return {
        format: value.format,
        version: 1,
        sourceId: value.sourceId,
        exportedAt: value.exportedAt,
        vaults,
        ...(["es", "en"].includes(value.preferences?.language)
            ? { preferences: { language: value.preferences.language } }
            : {})
    }
}

export async function encryptCompanyBackup(data: unknown, password: string, language: Language) {
    if (password.length < 12) throw new Error(t("Use at least 12 characters for the backup password."))
    const value = validateCompanyBackup(data)
    return JSON.stringify({
        format: "latamware-encrypted-backup",
        version: 1,
        payload: await encodeData(password, JSON.stringify({ ...value, preferences: { language } }))
    })
}

export async function decryptCompanyBackup(file: string, password: string) {
    try {
        const envelope = JSON.parse(file)
        if (
            envelope?.format !== "latamware-encrypted-backup" ||
            envelope.version !== 1 ||
            typeof envelope.payload !== "string" ||
            !envelope.payload.startsWith("vault:v2:")
        )
            throw invalid()
        const data = validateCompanyBackup(JSON.parse(await decodeData(password, envelope.payload)))
        if (new TextEncoder().encode(JSON.stringify(data)).length > 4 * 1024 * 1024) throw invalid()
        return data
    } catch {
        throw new Error(t("Could not open the backup. Check its password and file."))
    }
}
