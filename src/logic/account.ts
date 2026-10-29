import { t } from "@logic/i18n"
import { getStorage, setStorage, removeStorage, mutateAccount, clearAccountSession } from "@logic/storage"

import { deleteChromeExtensionAccount, getServicePassword } from "@logic/service"
import { generateAccountId } from "@logic/utils"
import { setMasterVerifier, verifyMasterPassword, removeMasterVerifier, createMasterVerifier } from "@logic/master"

import { createDefaultAlphabet } from "@logic/alphabet"
import { createDefaultVault } from "@logic/vault"
import { createDefaultSettings } from "@logic/settings"
import { encodeData, decodeData, downloadFile } from "@logic/utils"
import { validateAccountData } from "@logic/validation"
import { announceMasterPasswordChange } from "@logic/session"
import { showAlert } from "@logic/alert"

export const importAccount = (data: any) => {
    setStorage("account", data)
}

export const createAccount = (accountName: string, accountIcon = "user") => {

    const accounts = getStorage("accounts")
    const accountId = generateAccountId()

    if(!accounts) {
        setStorage("accounts", [ accountId ])
    } else {
        accounts.push(accountId)
        setStorage("accounts", accounts)
    }
    
    setStorage("current-account", accountId)

    createAccountData(accountId, accountName, accountIcon)

}

const createAccountData = (accountId: string, accountName = "Personal Account", accountIcon = "user")  => {
    createDefaultAlphabet(accountId)
    createDefaultVault(accountId)
    createDefaultSettings(accountId, accountName, accountIcon)
}

export const getAccountsLength = () => {
    const accounts = getStorage("accounts")
    if(!accounts || accounts.length === 0) return 0
    return accounts.length
}

export const getAccounts = () => {
    const accounts = getStorage("accounts")
    if(!accounts || accounts.length === 0) return []
    return accounts
}

export const getAccount = (id: string) => {
    const accounts = getAccounts()
    for (let index = 0; index < accounts.length; index++) {
        if(accounts[index] == id) return accounts[index]
    }
}

export const getAccountName = (accountId: string) => {
    const account = getStorage(accountId)
    if (account && account.settings) {
        const nameSetting = account.settings.find((setting: any) => setting.id === "account-name")
        if (nameSetting) return nameSetting.value
    }
    return accountId
}

export const getAccountIcon = (accountId: string) => {
    const account = getStorage(accountId)
    if (account && account.settings) {
        const iconSetting = account.settings.find((setting: any) => setting.id === "account-icon")
        if (iconSetting) return iconSetting.value
    }
    return "user"
}

export const updateAccount = (id: string) => {

    const accounts = getAccounts()

    for (let index = 0; index < accounts.length; index++) {
        if(accounts[index] === id) {
            break
        }
    }

    setStorage("accounts", accounts)
    
}

export const deleteAccount = (id: string) => {

    const accounts = getAccounts()

    for (let index = 0; index < accounts.length; index++) {
        if(accounts[index] === id) {
            accounts.splice(index, 1)
            break
        }
    }

    if (getStorage("current-account") === id) {
        setStorage("current-account", "")
    }

    clearAccountSession(id)
    removeStorage(id)
    
    setStorage("accounts", accounts)
    deleteChromeExtensionAccount({ accountId: id })
    
}

export const exportAccountData = async ({
    accountId,
    masterPassword
}: {
    accountId: string,
    masterPassword: string
}) => {
    const account = getStorage(accountId)
    const exportPayload = account && typeof account === "object" ? { ...account } : {}
    delete exportPayload.drive
    delete exportPayload.session

    const encodedData = await encodeData(masterPassword, JSON.stringify(exportPayload))
    downloadFile(encodedData, getExportFileName(accountId), "application/octet-stream")
    showAlert(t("Data exported successfully!"), "success", "database-export", 5000)
}

const reencrypt = async (value: string, oldPassword: string, newPassword: string) => {
    if (!value) return ""
    const plaintext = await decodeData(oldPassword, value)
    return oldPassword === newPassword && value.startsWith("vault:v2:") ? value : encodeData(newPassword, plaintext)
}

export const prepareImportedAccount = async (data: unknown, masterPassword: string) => {
    const account: any = validateAccountData(data)
    for (const secret of account.secrets) {
        secret.content = await reencrypt(secret.content, masterPassword, masterPassword)
        secret.description = await reencrypt(secret.description, masterPassword, masterPassword)
    }
    for (const service of account.services) {
        service.description = await reencrypt(service.description, masterPassword, masterPassword)
        if (service.password) service.password = await reencrypt(service.password, masterPassword, masterPassword)
    }
    if (!account.settings.some((setting: any) => setting.id === "store-master-verifier" && setting.value === false)) account.master = await createMasterVerifier(masterPassword)
    return account
}

export const restoreAccountData = async (accountId: string, masterPassword: string, encryptedData: string, legacy = false) => {
    await mutateAccount(accountId, async (current) => {
        let data = JSON.parse(await decodeData(masterPassword, encryptedData))
        if (legacy) {
            data = normalizeFields(data)
            data.settings = current.settings.map((setting: any) => setting.id === "default-alphabet" ? { ...setting, value: data.alphabets?.[0]?.id ?? "" } : setting)
        }
        const account = await prepareImportedAccount(data, masterPassword)
        // Restoring a backup cannot silently change which sessions are authorized.
        account.session = current.session
        return { account, result: undefined }
    })
}

export const importAccountData = ({ accountId, masterPassword, event, onImportComplete }: {
    accountId: string, masterPassword: string, event: any, onImportComplete: () => void
}) => {
    const file = event?.target?.files?.[0]
    if (!file) { showAlert(t("No file was selected"), "error", "exclamation-circle", 5000); return }
    const format = detectImportFileFormat(file)
    if (!format) { showAlert(t("Unsupported file format. Use .vault or .ovni"), "error", "exclamation-circle", 5000); return }
    if (file.size > 32 * 1024 * 1024) { showAlert(t("Backup exceeds the 32 MiB import limit"), "error", "exclamation-circle", 5000); return }
    const reader = new FileReader()
    reader.onload = async () => {
        try {
            await restoreAccountData(accountId, masterPassword, String(reader.result), format === "ovni")
            onImportComplete()
            showAlert(t("Data imported to your account!"), "success", "database-import", 5000)
        } catch {
            showAlert(t("Could not import this backup. Check the master password and file integrity. Existing data was kept."), "error", "exclamation-circle", 5000)
        }
    }
    reader.onerror = () => showAlert(t("Could not read the backup file"), "error", "exclamation-circle", 5000)
    reader.readAsText(file)
}

export const setAccountMasterPassword = async ({
    accountId,
    masterPassword
}: {
    accountId: string,
    masterPassword: string
}) => {
        const account = getStorage(accountId) || {}
        const settings = Array.isArray(account.settings) ? account.settings : []
        const storeMasterSetting = settings.find((setting: { id?: string }) => setting?.id === "store-master-verifier")

        if (storeMasterSetting && storeMasterSetting.value === false) {
            removeMasterVerifier(accountId)
            return
        }

        await setMasterVerifier({ accountId, masterPassword })
}

export const checkAccountMasterPassword = async ({
    accountId,
    masterPassword
}: {
    accountId: string,
    masterPassword: string
}) => {
        return await verifyMasterPassword({ accountId, masterPassword })
}

export const changeMasterPassword = async ({ accountId, currentMasterPassword, newMasterPassword, closeOtherSessions = true }: {
    accountId: string, currentMasterPassword: string, newMasterPassword: string, closeOtherSessions?: boolean
}) => {
    if (!currentMasterPassword || !newMasterPassword.trim() || currentMasterPassword === newMasterPassword) {
        showAlert(t("Enter the current password and a different, non-empty new password"), "error", "exclamation-circle", 5000)
        return false
    }
    try {
        const handoff = !closeOtherSessions ? await encodeData(currentMasterPassword, newMasterPassword) : undefined
        const session = { revision: generateAccountId(), revokePrevious: closeOtherSessions }
        await mutateAccount(accountId, async (current) => {
            if (!await verifyMasterPassword({ accountId, masterPassword: currentMasterPassword })) throw new Error(t("Incorrect current password"))
            const account: any = validateAccountData(current)
            for (const secret of account.secrets) {
                secret.content = await reencrypt(secret.content, currentMasterPassword, newMasterPassword)
                secret.description = await reencrypt(secret.description, currentMasterPassword, newMasterPassword)
            }
            for (const service of account.services) {
                const alphabet = account.alphabets.find((a: any) => a.id === service.alphabet)
                const password = await getServicePassword(currentMasterPassword, service, alphabet)
                service.password = await encodeData(newMasterPassword, password)
                service.description = await reencrypt(service.description, currentMasterPassword, newMasterPassword)
            }
            if (!account.settings.some((setting: any) => setting.id === "store-master-verifier" && setting.value === false)) account.master = await createMasterVerifier(newMasterPassword)
            return { account: { ...account, session }, result: undefined }
        })
        announceMasterPasswordChange({ accountId, revision: session.revision, closeOtherSessions, handoff })
        showAlert(t("Master password changed. Existing service passwords were preserved."), "success", "key", 5000)
        return true
    } catch {
        showAlert(t("Could not change the master password. Check the current password and retry. Existing data was kept."), "error", "exclamation-circle", 5000)
        return false
    }
}

const getExportFileName = (accountId: string) => {

    const rawAccountName = getAccountName(accountId)
    const safeAccountName = rawAccountName
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "account"

    const now = new Date()
    const day = String(now.getDate()).padStart(2, "0")
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const year = now.getFullYear()
    const hours = String(now.getHours()).padStart(2, "0")
    const minutes = String(now.getMinutes()).padStart(2, "0")
    const seconds = String(now.getSeconds()).padStart(2, "0")

    return `${safeAccountName}_${day}-${month}-${year}_${hours}${minutes}${seconds}.vault`

}

const normalizeFields = (data: any): any => {

    if (Array.isArray(data)) {
        return data.map(item => normalizeFields(item))
    }

    if (data !== null && typeof data === "object") {

        const normalized: any = {}

        for (const key in data) {

            if (data.hasOwnProperty(key)) {

                const value = data[key]
                let newKey = key
                
                if (key === "folder") {
                    newKey = "vault"
                } else if (key === "alphabet" && Array.isArray(value)) {
                    newKey = "alphabets"
                } else if (key === "passwords") {
                    newKey = "services"
                } else if (key === "folders") {
                    newKey = "vaults"
                } else if (key.endsWith("id") && key !== "id") {
                    newKey = "id"
                }
                
                normalized[newKey] = normalizeFields(value)
            }
        }

        if (Array.isArray(normalized.services)) {
            normalized.services = normalized.services.map((service: any) => ({
                ...service,
                icon: "password-user",
                description: "",
                url: ""
            }))
        }

        if (Array.isArray(normalized.alphabets)) {
            normalized.alphabets = normalized.alphabets.map((alphabet: any) => ({
                ...alphabet,
                icon: "abc"
            }))
        }

        return normalized

    }

    return data

}

const detectImportFileFormat = (file: File): "vault" | "ovni" | null => {
    const fileName = file?.name?.toLowerCase() || ""
    if (fileName.endsWith(".vault")) return "vault"
    if (fileName.endsWith(".ovni")) return "ovni" // For old .ovni files compatibility
    return null
}
