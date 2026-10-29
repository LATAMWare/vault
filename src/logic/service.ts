import { t } from "@logic/i18n"
import { getStorage, setStorage, mutateAccount } from "@logic/storage"
import { generateId, genServicePassword, copyToClipboard, encodeData, decodeData, CURRENT_PASSWORD_ALGORITHM } from "@logic/utils"
import { showAlert } from "@logic/alert"
import { type IService } from "@interface/index"
import { validateService } from "@logic/validation"
import { assertAccountPassword } from "@logic/master"
import { getAlphabetList } from "@logic/alphabet"
import { getAccountName, getAccountIcon } from "@logic/account"

export const getServiceDescription = async (data: string, masterPassword: string) => {
    if (!data || typeof data !== 'string' || data.trim() === '') return ""
    return decodeData(masterPassword, data)
}

export const sendChromeExtensionCommand = ({ type, payload = {}, requiredCapabilities = [] }: { type: string, payload?: Record<string, any>, requiredCapabilities?: string[] }): Promise<boolean> => {
    if (typeof window === "undefined") return Promise.resolve(false)

    return new Promise((resolve) => {
        const requestId = `cmd-${Date.now()}-${Math.random()}`
        const timeout = setTimeout(() => {
            window.removeEventListener('message', responseHandler)
            console.warn(`Command timeout: ${type}`)
            resolve(false)
        }, 5000) // 5 second timeout

        const responseHandler = (event: MessageEvent) => {
            if (
                event.source === window && event.origin === window.location.origin &&
                event.data?.source === 'vault-extension-response' &&
                event.data?.requestId === requestId
            ) {
                clearTimeout(timeout)
                window.removeEventListener('message', responseHandler)
                const capabilities = Array.isArray(event.data?.capabilities) ? event.data.capabilities : []
                resolve(event.data?.success === true && requiredCapabilities.every(capability => capabilities.includes(capability)))
            }
        }

        window.addEventListener('message', responseHandler)

        const detail = {
            source: "vault-extension-command",
            type,
            payload,
            requestId
        }

        window.postMessage(detail, window.location.origin)
    })
}

export const deleteChromeExtensionAccount = async ({ accountId }: { accountId?: string } = {}): Promise<boolean> => {
    const resolvedAccountId = accountId || getStorage("current-account")
    if (!resolvedAccountId) return false

    return await sendChromeExtensionCommand({
        type: "DELETE_ACCOUNT",
        payload: { accountId: resolvedAccountId }
    })
}

export const clearChromeExtensionData = async (): Promise<boolean> => await sendChromeExtensionCommand({
    type: "CLEAR_ALL",
    payload: {}
})

export const syncServicesWithChromeExtension = async ({ accountId }: { accountId?: string } = {}) => {

    const resolvedAccountId = accountId || getStorage("current-account")
    const currentAccount = resolvedAccountId ? getStorage(resolvedAccountId) : null

    if (!currentAccount || typeof window === "undefined") {
        return showAlert(t("Failed to sync services with Chrome extension"), "error", "x", 2500)
    }

    const services = Array.isArray(currentAccount.services) ? currentAccount.services : []
    const requiredCapabilities: string[] = []
    if (services.some((service: IService) => service.algorithm === "pbkdf2-v2")) requiredCapabilities.push("pbkdf2-v2")
    if (services.some((service: IService) => service.password)) requiredCapabilities.push("encrypted-service-passwords")
    if (currentAccount.master?.iterations) requiredCapabilities.push("master-verifier-iterations")
    if (requiredCapabilities.length && !await sendChromeExtensionCommand({ type: "GET_CAPABILITIES", requiredCapabilities })) {
        showAlert(t("This extension does not support the current vault format. Update the extension before syncing this account."), "error", "alert-circle", 5000)
        return false
    }
    const alphabets = Array.isArray(currentAccount.alphabets) ? currentAccount.alphabets : []
    const info = {
        id: resolvedAccountId,
        name: getAccountName(resolvedAccountId),
        icon: getAccountIcon(resolvedAccountId),
    }
    const master = currentAccount.master || null

    const detail = {
        source: "vault-extension-sync",
        payload: {
            info,
            services,
            alphabets,
            master
        }
    }

    window.postMessage(detail, window.location.origin)
    showAlert(t("Vault data sent to the compatible extension"), "success", "check", 2500)
    return true

}

export const importServices = ({ accountId, services }: { accountId: string, services: IService[] }) => {

    let account = getStorage(accountId)

    account = {
        ...account,
        services: services
    }

    setStorage(accountId, account)

}

export const getServiceCount = (accountId: string) => {
    let account = getStorage(accountId)
    const services = account.services
    if(!services || services.length === 0) return 0
    return services.length
}

export const getServiceCountInVault = (accountId: string, vaultId: string) => {
    let account = getStorage(accountId)
    const services = account.services
    if(!services || services.length === 0) return 0
    return services.filter((service: IService) => service.vault === vaultId).length
}

export const getAllServiceList = (accountId: string) => {
    let account = getStorage(accountId)
    const services = account.services
    if(!services) return []
    return services
}

export const getServiceList = ({ accountId, vaultId }: { accountId: string, vaultId: string }): any => {

    let account = getStorage(accountId)
    const services = account.services

    if(!services) return []

    const vaultServices = [] as IService[]

    for (let index = 0; index < services.length; index++) {
        if(services[index].vault === vaultId) {
            vaultServices.push(services[index])
        }
    }

    return vaultServices

}

export const getService = ({ accountId, serviceId }: { accountId: string, serviceId: string }) => {

    let account = getStorage(accountId)
    const services = account.services

    if(!services) return []

    for (let index = 0; index < services.length; index++) {
        if(services[index].id === serviceId) return services[index]
    }

}

export const reorderService = ({ accountId, vaultId, serviceId, direction }: { accountId: string, vaultId: string, serviceId: string, direction: -1 | 1 }) => {
    const account = getStorage(accountId)
    const services = Array.isArray(account?.services) ? account.services : []
    const vaultServiceIndexes = services.reduce((indexes: number[], service: IService, index: number) => {
        if (service.vault === vaultId) indexes.push(index)
        return indexes
    }, [])
    const currentVaultIndex = vaultServiceIndexes.findIndex((index: number) => services[index].id === serviceId)
    const targetVaultIndex = currentVaultIndex + direction

    if (currentVaultIndex < 0 || targetVaultIndex < 0 || targetVaultIndex >= vaultServiceIndexes.length) return

    const currentIndex = vaultServiceIndexes[currentVaultIndex]
    const targetIndex = vaultServiceIndexes[targetVaultIndex]
    const [movedService] = services.splice(currentIndex, 1)
    services.splice(targetIndex > currentIndex ? targetIndex : targetIndex, 0, movedService)
    setStorage(accountId, { ...account, services })
}

export const getServicePassword = async (masterPassword: string, service: IService, alphabet: { identifier: string, characters: string }) => {
    if (service.password) return decodeData(masterPassword, service.password)
    return genServicePassword(masterPassword, service.identifier, service.length, alphabet, service.version ?? 1, service.algorithm ?? "legacy")
}

export const createService = async (input: {
    accountId: string, vaultId: string, name: string, description: string, url: string, icon: string,
    identifier: string, alphabet: string, length: number, masterPassword: string
}) => mutateAccount(input.accountId, async (account) => {
    await assertAccountPassword(input.accountId, input.masterPassword)
    const service: IService = {
        id: generateId(), name: input.name, icon: input.icon, description: "", url: input.url,
        identifier: input.identifier, alphabet: input.alphabet, length: input.length, vault: input.vaultId,
        version: 1, algorithm: CURRENT_PASSWORD_ALGORITHM
    }
    validateService(service, account)
    service.description = input.description ? await encodeData(input.masterPassword, input.description) : ""
    return { account: { ...account, services: [...(account.services ?? []), service] }, result: service.id }
})

export const updateService = async (input: {
    accountId: string, serviceId: string, vaultId: string, name: string, description: string, icon: string,
    url: string, identifier: string, alphabet: string, length: number, version: number, masterPassword: string
}) => mutateAccount(input.accountId, async (account) => {
    await assertAccountPassword(input.accountId, input.masterPassword)
    const original = account.services?.find((service: IService) => service.id === input.serviceId)
    if (!original) throw new Error(t("Service no longer exists"))
    const next: IService = {
        ...original, name: input.name, icon: input.icon, url: input.url, identifier: input.identifier,
        alphabet: input.alphabet, length: input.length, version: input.version, vault: input.vaultId,
        description: input.description ? await encodeData(input.masterPassword, input.description) : ""
    }
    validateService(next, account)
    if (original.identifier !== next.identifier || original.alphabet !== next.alphabet || original.length !== next.length || (original.version ?? 1) !== next.version) { delete next.password; next.algorithm = CURRENT_PASSWORD_ALGORITHM }
    return { account: { ...account, services: account.services.map((service: IService) => service.id === next.id ? next : service) }, result: undefined }
})

export const deleteService = ({ accountId, serviceId }: { accountId: string, serviceId: string }) => {


    let account = getStorage(accountId)
    let services = account.services

    for (let index = 0; index < services.length; index++) {
        if(services[index].id === serviceId) {
            services.splice(index, 1)
            break
        }
    }
    
    account = {
        ...account,
        services: services
    }

    setStorage(accountId, account)

}

export const copyServicePasswordToClipboard = async ({
    accountId,
    masterPassword,
    serviceId
}: {
    accountId: string,
    masterPassword: string,
    serviceId: string,
}) => {

    try {
        
        const service = getService({ accountId, serviceId })
        const alphabets = getAlphabetList(accountId)
        const alphabetData = alphabets.find((a: any) => a.id === service.alphabet)
        const password = await getServicePassword(masterPassword, service, alphabetData)

        await copyToClipboard(password)
        
        showAlert(
            t("{{value0}} password copied to clipboard!", { value0: service.name === "" ? t("Service") : service.name }),
            'success',
            'check', 
            3000
        )
        return true

    } catch (error) {
        showAlert(t("Error copying password"), 'error', 'alert-circle', 3000)
        return false
        
    }

}
