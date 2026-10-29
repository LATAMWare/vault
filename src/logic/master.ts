import { t } from "@logic/i18n"
import { getStorage, setStorage, mutateAccount } from "@logic/storage"
import { bufToBase64, base64ToBuf, randomBytes, deriveHmacKey, equalArrayBuffers, ensureCryptoAvailability, KDF_ITERATIONS, decodeData } from "@logic/utils"

const getAccountStoreMasterVerifierSetting = (account: any): boolean => {
    const settings = Array.isArray(account?.settings) ? account.settings : []
    const matchingSetting = settings.find((setting: { id?: string, value?: unknown }) => setting?.id === "store-master-verifier")

    if (!matchingSetting || typeof matchingSetting.value === "undefined") return true
    return Boolean(matchingSetting.value)
}

export const createMasterVerifier = async (masterPassword: string) => {
    const cryptoApi = ensureCryptoAvailability()
    const salt = randomBytes(16)
    const key = await deriveHmacKey(masterPassword, salt)
    const verifier = await cryptoApi.subtle.sign('HMAC', key, new TextEncoder().encode('vault-verifier-v1'))
    return { salt: bufToBase64(salt), verifier: bufToBase64(verifier), iterations: KDF_ITERATIONS }
}

export const setMasterVerifier = async ({
    accountId,
    masterPassword
}: {
    accountId: string,
    masterPassword: string
}) => {

    await mutateAccount(accountId, async (account) => {
        if (!getAccountStoreMasterVerifierSetting(account)) delete account.master
        else account.master = await createMasterVerifier(masterPassword)
        return { account, result: undefined }
    })

}

export const verifyMasterPassword = async ({
    accountId,
    masterPassword
}: {
    accountId: string,
    masterPassword: string
}) => {

    const account = getStorage(accountId)
    if (!account) return false
    if (!account.master) return true

    if (!getAccountStoreMasterVerifierSetting(account)) return true

    const cryptoApi = ensureCryptoAvailability()
    const { salt: saltB64, verifier: verifierB64 } = account.master

    if (!saltB64 || !verifierB64) return false

    let saltBuf: ArrayBuffer, storedVerifierBuf: ArrayBuffer
    try {
        saltBuf = base64ToBuf(saltB64)
        storedVerifierBuf = base64ToBuf(verifierB64)
    } catch { return false }
    if (saltBuf.byteLength !== 16 || storedVerifierBuf.byteLength !== 32) return false
    const iterations = account.master.iterations ?? 200000
    if (![200000, KDF_ITERATIONS].includes(iterations)) return false
    const key = await deriveHmacKey(masterPassword, saltBuf, iterations)
    const enc = new TextEncoder()
    const computed = await cryptoApi.subtle.sign('HMAC', key, enc.encode('vault-verifier-v1'))

    return equalArrayBuffers(computed, storedVerifierBuf)

}

export const removeMasterVerifier = (accountId: string) => {

    const account = getStorage(accountId)
    if (!account) return

    delete account.master

    setStorage(accountId, account)

}

export const assertAccountPassword = async (accountId: string, masterPassword: string) => {
    if (!await verifyMasterPassword({ accountId, masterPassword })) throw new Error(t("Account was locked or its master password changed. Unlock it again."))
    const account = getStorage(accountId)
    if (!account.master || !getAccountStoreMasterVerifierSetting(account)) {
        const encrypted = account.secrets?.find((secret: any) => secret.content)?.content
            || account.services?.find((service: any) => service.password || service.description)?.password
            || account.services?.find((service: any) => service.description)?.description
        if (encrypted) await decodeData(masterPassword, encrypted)
    }
}
