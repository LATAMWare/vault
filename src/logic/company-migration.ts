import { getStorage } from "./storage"
import { validateAccountData } from "./validation"
import { verifyMasterPassword, assertAccountPassword } from "./master"
import { decodeData } from "./utils"
import { getServicePassword } from "./service"
import { t } from "./i18n"
import type { ItemContent } from "../interfaces/company"

export function localMigrationAccounts(): { id: string; name: string }[] {
    const ids = getStorage("accounts")
    if (!Array.isArray(ids)) return []
    return ids
        .filter((id): id is string => typeof id === "string")
        .flatMap((id) => {
            const account = getStorage(id)
            return account && typeof account === "object"
                ? [
                      {
                          id,
                          name: String(
                              account.settings?.find((setting: any) => setting.id === "account-name")?.value ?? id
                          )
                      }
                  ]
                : []
        })
}

/** Read/decrypt locally. Never send the old master password, verifiers, seeds or OAuth data. */
export async function prepareLocalMigration(accountId: string, password: string) {
    const source = getStorage(accountId)
    const account = validateAccountData(source)
    if (!(await verifyMasterPassword({ accountId, masterPassword: password })))
        throw new Error(t("Master Password is incorrect"))
    await assertAccountPassword(accountId, password)
    const hasCiphertext =
        account.secrets.some((secret) => secret.content) ||
        account.services.some((service) => service.password || service.description)
    const verified =
        source?.master?.verifier &&
        source.settings?.find((setting: any) => setting.id === "store-master-verifier")?.value !== false
    if (!verified && !hasCiphertext && account.services.length)
        throw new Error(
            t("This account cannot verify the old master password. Verify it in local mode before importing.")
        )
    return materializeLocalAccount(account, accountId, password)
}

async function materializeLocalAccount(
    account: ReturnType<typeof validateAccountData>,
    sourceId: string,
    password: string
) {
    const vaults = []
    for (const vault of account.vaults) {
        const items: ItemContent[] = []
        for (const secret of account.secrets.filter((item) => item.vault === vault.id))
            items.push({
                kind: "note",
                title: secret.name,
                username: "",
                password: "",
                url: "",
                notes: [
                    secret.description ? await decodeData(password, secret.description) : "",
                    await decodeData(password, secret.content)
                ]
                    .filter(Boolean)
                    .join("\n\n")
            })
        for (const service of account.services.filter((item) => item.vault === vault.id)) {
            const alphabet = account.alphabets.find((item) => item.id === service.alphabet)!
            items.push({
                kind: "password",
                title: service.name,
                username: "",
                url: service.url,
                password: await getServicePassword(password, service, alphabet),
                notes: service.description ? await decodeData(password, service.description) : ""
            })
        }
        vaults.push({ name: vault.name, items })
    }
    return { sourceId, vaults }
}

/** An encrypted file authenticates the old password without restoring or changing browser storage. */
export async function prepareLocalBackup(encrypted: string, password: string) {
    try {
        const account = validateAccountData(JSON.parse(await decodeData(password, encrypted)))
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encrypted))
        const sourceId =
            "local-file-" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
        return await materializeLocalAccount(account, sourceId, password)
    } catch {
        throw new Error(t("Could not open the backup. Check its password and file."))
    }
}
