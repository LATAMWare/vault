import { t } from "@logic/i18n"
import type { IService } from "@interface/index"

const record = (value: any): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value)
const fail = (): never => { throw new Error(t("Invalid vault data. No account data was replaced.")) }
const string = (value: any): value is string => typeof value === "string"
const id = (value: any) => string(value) && value.length > 0 && value.length <= 256
const list = (value: any): any[] => Array.isArray(value) ? value : fail()
const unique = (items: any[]) => {
    if (items.some(item => !record(item) || !id(item.id)) || new Set(items.map(item => item.id)).size !== items.length) fail()
}

export const validateService = (service: Pick<IService, "identifier" | "length" | "version" | "alphabet" | "vault">, account: any) => {
    if (!string(service.identifier) || !service.identifier.trim() || !Number.isInteger(service.length) || service.length < 1 || service.length > 1024
        || !Number.isInteger(service.version) || service.version < 1 || service.version > 999
        || !account.alphabets?.some((a: any) => a.id === service.alphabet)
        || !account.vaults?.some((v: any) => v.id === service.vault)) throw new Error(t("Invalid service, alphabet, vault, length or version"))
}

/** Validate the complete payload before replacing any local data. Unknown fields are discarded. */
export const validateAccountData = (input: unknown) => {
    if (!record(input)) return fail()
    const settings = list(input.settings), alphabets = list(input.alphabets), vaults = list(input.vaults)
    const services = list(input.services ?? []), secrets = list(input.secrets ?? [])
    for (const items of [settings, alphabets, vaults, services, secrets]) unique(items)
    for (const setting of settings) {
        if (!["string", "number", "boolean"].includes(typeof setting.value) || (typeof setting.value === "number" && !Number.isFinite(setting.value))) fail()
        if (["store-master-verifier", "google-drive-enabled", "show-passwords", "show-animations", "disable-gradient-background", "disable-colored-background", "enable-organize-vaults", "enable-organize-services"].includes(setting.id) && typeof setting.value !== "boolean") fail()
        if (setting.id === "default-password-length" && (!Number.isInteger(setting.value) || setting.value < 1 || setting.value > 1024)) fail()
        if (["account-name", "account-icon", "theme-color", "default-alphabet", "google-drive-file-id"].includes(setting.id) && !string(setting.value)) fail()
    }
    for (const alphabet of alphabets) {
        if (![alphabet.name, alphabet.identifier, alphabet.characters].every(string) || !alphabet.identifier || !alphabet.characters || Array.from(alphabet.characters).length > 65536) fail()
    }
    for (const vault of vaults) if (!string(vault.name) || !string(vault.icon)) fail()
    const account = { settings, alphabets, vaults }
    for (const service of services) {
        validateService({ ...service, version: service.version ?? 1 }, account)
        if (![service.name, service.icon, service.description ?? "", service.url ?? ""].every(string)) fail()
        if (service.algorithm !== undefined && !["legacy", "pbkdf2-v2"].includes(service.algorithm)) fail()
        if (service.password !== undefined && !string(service.password)) fail()
    }
    for (const secret of secrets) {
        if (![secret.name, secret.icon, secret.content, secret.description ?? ""].every(string) || !vaults.some(v => v.id === secret.vault)) fail()
    }
    // Never trust an imported verifier or OAuth token; the caller rebuilds the verifier from the actual decryption key.
    return {
        settings: settings.map(({ id, value }) => ({ id, value })),
        alphabets: alphabets.map(({ id, name, identifier, characters, description = "", icon = "abc" }) => {
            if (!string(description) || !string(icon)) fail()
            return { id, name, identifier, characters, description, icon }
        }),
        vaults: vaults.map(({ id, name, icon }) => ({ id, name, icon })),
        services: services.map(({ id, name, icon, description = "", url = "", identifier, alphabet, length, vault, version = 1, algorithm, password }) => ({
            id, name, icon, description, url, identifier, alphabet, length, vault, version,
            ...(algorithm ? { algorithm } : {}), ...(password ? { password } : {})
        })),
        secrets: secrets.map(({ id, name, content, description = "", icon, vault }) => ({ id, name, content, description, icon, vault }))
    }
}
