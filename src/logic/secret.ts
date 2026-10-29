import { t } from "@logic/i18n"
import { getStorage, setStorage, mutateAccount } from "@logic/storage"
import { showAlert } from "@logic/alert"
import { assertAccountPassword } from "@logic/master"
import { generateId, encodeData, decodeData, copyToClipboard } from "@logic/utils"
import { type ISecret } from "@interface/index"

export const importSecrets = ({ accountId, secrets }: { accountId: string, secrets: ISecret[] }) => {

    let account = getStorage(accountId)

    account = {
        ...account,
        secrets: secrets
    }

    setStorage(accountId, account)

}

export const getSecretCount = (accountId: string) => {
    let account = getStorage(accountId)
    const secrets = account.secrets
    if(!secrets || secrets.length === 0) return 0
    return secrets.length
}

export const getSecretCountInVault = (accountId: string, vaultId: string) => {
    let account = getStorage(accountId)
    const secrets = account.secrets
    if(!secrets || secrets.length === 0) return 0
    return secrets.filter((secret: ISecret) => secret.vault === vaultId).length
}

export const getAllSecretList = (accountId: string) => {
    let account = getStorage(accountId)
    const secrets = account.secrets
    if(!secrets) return []
    return secrets
}

export const getSecretList = ({ accountId, vaultId }: { accountId: string, vaultId: string, masterPassword?: string }): any => {

    let account = getStorage(accountId)
    const secrets = account.secrets

    if(!secrets) return []

    const vaultSecrets = [] as ISecret[]

    for (let index = 0; index < secrets.length; index++) {
        if(secrets[index].vault === vaultId) {
            vaultSecrets.push(secrets[index])
        }
    }

    return vaultSecrets

}

export const getSecret = ({ accountId, secretId }: { accountId: string, secretId: string }) => {

    let account = getStorage(accountId)
    const secrets = account.secrets

    if(!secrets) return undefined

    for (let index = 0; index < secrets.length; index++) {
        if(secrets[index].id === secretId) {
            const secret = { ...secrets[index] }
            return secret
        }
    }

}

export const reorderSecret = ({ accountId, vaultId, secretId, direction }: { accountId: string, vaultId: string, secretId: string, direction: -1 | 1 }) => {
    const account = getStorage(accountId)
    const secrets = Array.isArray(account?.secrets) ? account.secrets : []
    const vaultSecretIndexes = secrets.reduce((indexes: number[], secret: ISecret, index: number) => {
        if (secret.vault === vaultId) indexes.push(index)
        return indexes
    }, [])
    let currentVaultIndex = -1
    for (let index = 0; index < vaultSecretIndexes.length; index++) {
        if (secrets[vaultSecretIndexes[index]].id === secretId) {
            currentVaultIndex = index
            break
        }
    }
    const targetVaultIndex = currentVaultIndex + direction

    if (currentVaultIndex < 0 || targetVaultIndex < 0 || targetVaultIndex >= vaultSecretIndexes.length) return

    const currentIndex = vaultSecretIndexes[currentVaultIndex]
    const targetIndex = vaultSecretIndexes[targetVaultIndex]
    const [movedSecret] = secrets.splice(currentIndex, 1)
    secrets.splice(targetIndex > currentIndex ? targetIndex : targetIndex, 0, movedSecret)
    setStorage(accountId, { ...account, secrets })
}

export const createSecret = async (input: {
    accountId: string, name: string, content: string, description: string, icon: string, vault: string, masterPassword: string
}) => mutateAccount(input.accountId, async (account) => {
    await assertAccountPassword(input.accountId, input.masterPassword)
    if (!input.content || !account.vaults?.some((v: any) => v.id === input.vault)) throw new Error(t("Enter content and select a valid vault"))
    const secret: ISecret = {
        id: generateId(), name: input.name, icon: input.icon, vault: input.vault,
        content: await encodeData(input.masterPassword, input.content),
        description: input.description ? await encodeData(input.masterPassword, input.description) : ""
    }
    return { account: { ...account, secrets: [...(account.secrets ?? []), secret] }, result: secret.id }
})

export const updateSecret = async (input: {
    accountId: string, secretId: string, name: string, content: string, description: string, icon: string, vault: string, masterPassword: string
}) => mutateAccount(input.accountId, async (account) => {
    await assertAccountPassword(input.accountId, input.masterPassword)
    if (!account.secrets?.some((secret: ISecret) => secret.id === input.secretId)) throw new Error(t("Secret no longer exists"))
    if (!input.content || !account.vaults?.some((v: any) => v.id === input.vault)) throw new Error(t("Enter content and select a valid vault"))
    const next: ISecret = {
        id: input.secretId, name: input.name, icon: input.icon, vault: input.vault,
        content: await encodeData(input.masterPassword, input.content),
        description: input.description ? await encodeData(input.masterPassword, input.description) : ""
    }
    return { account: { ...account, secrets: account.secrets.map((secret: ISecret) => secret.id === next.id ? next : secret) }, result: undefined }
})

export const deleteSecret = ({ accountId, secretId }: { accountId: string, secretId: string }) => {


    let account = getStorage(accountId)
    let secrets = account.secrets

    for (let index = 0; index < secrets.length; index++) {
        if(secrets[index].id === secretId) {
            secrets.splice(index, 1)
            break
        }
    }
    
    account = {
        ...account,
        secrets: secrets
    }

    setStorage(accountId, account)

}

export const copySecretToClipboard = async ({
    accountId,
    masterPassword,
    secretId
}: {
    accountId: string,
    masterPassword: string,
    secretId: string,
}) => {

    try {

        const secret = getSecret({ accountId, secretId })

        if(!secret) {
            showAlert(t("Secret not found"), 'error', 'alert-circle', 3000)
            return false
        }

        const secretContent = await decodeData(masterPassword, secret.content)

        await copyToClipboard(secretContent)
        
        showAlert(
            t("{{value0}} copied to clipboard!", { value0: secret.name === "" ? t("Secret") : secret.name }),
            'success',
            'check', 
            3000
        )
        return true

    } catch (error) {
        showAlert(t("Error copying secret"), 'error', 'alert-circle', 3000)
        return false
    }

}

export const getSecretContent = async (data: string, masterPassword: string) => {
    if (!data || typeof data !== 'string' || data.trim() === '') return ""
    return decodeData(masterPassword, data)
}
