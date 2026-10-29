import { t } from "@logic/i18n"
const isBrowser = () => typeof window !== "undefined"

const getStorageInstance = (type: "local" | "session" = "local") => {
    if (!isBrowser()) return null

    const storage = type === "session" ? window.sessionStorage : window.localStorage
    if (!storage) return null

    return storage
}

export const setStorage = (key: string, value: any): void => {
    if (!isBrowser()) return
    if (typeof value === "object") value = JSON.stringify(value)
    getStorageInstance("local")?.setItem(key, value)

    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("vault-storage-updated", { detail: { key } }))
    }
}

export const getStorage = (key: string) => {
    const storage = getStorageInstance("local")
    if (!storage) return null

    const data: any = storage.getItem(key)
    if (!data) return data
    if (/^\s*{\s*"/.test(data) || /^\s*\[/.test(data)) return JSON.parse(data)
    return data
}

export const removeStorage = (key: string): void => {
    getStorageInstance("local")?.removeItem(key)
}

export const setSessionStorage = (key: string, value: any): void => {
    if (!isBrowser()) return
    if (typeof value === "object") value = JSON.stringify(value)
    getStorageInstance("session")?.setItem(key, value)
}

export const getSessionStorage = (key: string) => {
    const storage = getStorageInstance("session")
    if (!storage) return null

    const data: any = storage.getItem(key)
    if (!data) return data
    if (/^\s*{\s*"/.test(data) || /^\s*\[/.test(data)) return JSON.parse(data)
    return data
}

export const removeSessionStorage = (key: string): void => {
    getStorageInstance("session")?.removeItem(key)
}

const pending = new Map<string, Promise<unknown>>()

/** Serialize async writes across tabs. Detect intervening synchronous edits before committing. */
export const mutateAccount = async <T>(accountId: string, change: (account: any) => Promise<{ account: any, result: T }>): Promise<T> => {
    const commit = async () => {
        const original = getStorageInstance()?.getItem(accountId)
        const current = getStorage(accountId)
        if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(t("Account no longer exists"))
        const next = await change(current)
        if (getStorageInstance()?.getItem(accountId) !== original) throw new Error(t("Account changed in another operation. Please retry."))
        setStorage(accountId, next.account)
        return next.result
    }
    if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request(`vault-account:${accountId}`, commit)
    }
    const previous = pending.get(accountId) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(commit)
    pending.set(accountId, operation)
    try { return await operation } finally { if (pending.get(accountId) === operation) pending.delete(accountId) }
}

export const clearAccountSession = (accountId: string) => removeSessionStorage(`vault-google-drive:${accountId}`)
