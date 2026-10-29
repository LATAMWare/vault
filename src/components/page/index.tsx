import { useEffect, useState, useRef } from "react"

import Content from "@component/global/content"
import CreateVaultModal from "@component/sections/vault/create-vault"
import { SidebarWithResizer } from "@component/global/resize"

import { getStorage } from "@logic/storage"
import { applyThemeColor } from "@logic/settings"
import { decodeData } from "@logic/utils"
import { watchPasswordChanges } from "@logic/session"
import { checkAccountMasterPassword } from "@logic/account"
import { useI18n, detectLanguage, setLanguage, LANGUAGE_STORAGE_KEY } from "@logic/i18n"

const Page = ({ corporateUser = null }: { corporateUser?: { id: string; email: string } | null }) => {
    const { language, t } = useI18n()
    useEffect(() => {
        void setLanguage(detectLanguage(), false)
        const handleLanguage = (event: StorageEvent) => {
            if (event.key === LANGUAGE_STORAGE_KEY) void setLanguage(detectLanguage(), false)
        }
        window.addEventListener("storage", handleLanguage)
        return () => window.removeEventListener("storage", handleLanguage)
    }, [])
    useEffect(() => {
        document.documentElement.lang = language
        document.title = t("VAULT - Password Manager")
    }, [language])

    const [ activeSection, setActiveSection ] = useState("home")
    const [ activeVaultId, setActiveVaultId ] = useState<string | null>(null)

    const [ account, setAccount ] = useState<any>()
    const [ accountId, setAccountId ] = useState("")
    const [ masterPassword, setMasterPassword ] = useState("")
    const sessionRevision = useRef("")

    const [ vaultId, setVaultId ] = useState("")
    const [ createVaultModalOpen, setCreateVaultModalOpen ] = useState(false)

    useEffect(() => {
        if (!corporateUser) return
        const controller = new AbortController()
        const checkSession = async () => {
            try {
                const response = await fetch("/api/access", { cache: "no-store", signal: controller.signal })
                const data = response.ok ? await response.json() : null
                if (data?.user?.id === corporateUser.id) return
            } catch { if (controller.signal.aborted) return }
            setMasterPassword("")
            setAccountId("")
            window.location.replace("/login")
        }
        const interval = window.setInterval(() => { void checkSession() }, 60000)
        const onFocus = () => { void checkSession() }
        const onVisible = () => { if (document.visibilityState === "visible") void checkSession() }
        void checkSession()
        window.addEventListener("focus", onFocus)
        window.addEventListener("pageshow", onFocus)
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            controller.abort()
            window.clearInterval(interval)
            window.removeEventListener("focus", onFocus)
            window.removeEventListener("pageshow", onFocus)
            document.removeEventListener("visibilitychange", onVisible)
        }
    }, [corporateUser?.id])

    const syncAccount = (selectedAccountId = accountId) => {
        const nextAccount = selectedAccountId ? getStorage(selectedAccountId) : null
        setAccount(nextAccount)
    }

    const onSubmitForm = (accountId: string, masterPassword: string) => {
        sessionRevision.current = getStorage(accountId)?.session?.revision ?? ""
        setMasterPassword(masterPassword)
        setAccountId(accountId)
        setActiveSection("home")
        setActiveVaultId(null)
        setVaultId("")
        syncAccount(accountId)
    }

    const handleSectionChange = (section: string, vaultId?: string) => {
        setActiveSection(section)
        if (section === "vault" && vaultId) {
            setActiveVaultId(vaultId)
            setVaultId(vaultId)
        } else if (section !== "vault") {
            setActiveVaultId(null)
            setVaultId("")
        }
    }

    useEffect(() => {
        if (activeSection !== "vault") return

        const vaults = Array.isArray(account?.vaults) ? account.vaults : []
        const selectedVaultId = activeVaultId ?? vaultId

        if (!selectedVaultId || !vaults.some((vault: any) => vault.id === selectedVaultId)) {
            setActiveSection("home")
            setActiveVaultId(null)
            setVaultId("")
        }
    }, [account, activeSection, activeVaultId, vaultId])

    useEffect(() => {
        if (accountId) {
            applyThemeColor(accountId)
        }
    }, [accountId])

    useEffect(() => {
        if (!accountId) return
        let active = true
        const lock = () => {
            setMasterPassword(""); setAccountId(""); setAccount(undefined)
            setActiveSection("home"); setActiveVaultId(null); setVaultId(""); setCreateVaultModalOpen(false)
        }
        const onStorage = (event: StorageEvent) => {
            if (event.key !== accountId && event.key !== null) return
            const current = getStorage(accountId)
            if (!current || (current.session?.revokePrevious && current.session.revision !== sessionRevision.current)) { lock(); return }
            syncAccount(accountId)
        }
        const unwatch = watchPasswordChanges(async notice => {
            if (notice.accountId !== accountId || notice.revision === sessionRevision.current) return
            if (getStorage(accountId)?.session?.revision !== notice.revision) return
            if (notice.closeOtherSessions) { lock(); return }
            try {
                const nextPassword = await decodeData(masterPassword, notice.handoff ?? "")
                if (!await checkAccountMasterPassword({ accountId, masterPassword: nextPassword })) throw new Error(t("Invalid session update"))
                if (!active) return
                sessionRevision.current = notice.revision
                setMasterPassword(nextPassword)
                syncAccount(accountId)
            } catch { if (active) lock() }
        })
        window.addEventListener("storage", onStorage)
        return () => { active = false; unwatch(); window.removeEventListener("storage", onStorage) }
    }, [accountId, masterPassword])

    useEffect(() => {
        if (!accountId || typeof window === "undefined") return

        const handleStorageUpdate = () => {
            syncAccount(accountId)
        }

        window.addEventListener("vault-storage-updated", handleStorageUpdate)

        return () => {
            window.removeEventListener("vault-storage-updated", handleStorageUpdate)
        }
    }, [accountId])

    return (
        <div className="z-0 h-screen flex flex-col">

            {corporateUser && (
                <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-white border-b border-white/10 bg-black/30">
                    <span>{corporateUser.email}</span>
                    <a className="underline" href="/logout">{t("Sign out")}</a>
                </div>
            )}

            <CreateVaultModal
                open={createVaultModalOpen}
                accountId={accountId}
                onCreate={() => {
                    syncAccount(accountId)
                }}
                onClose={() => setCreateVaultModalOpen(false)}
            />

            <div className="p-2 flex-1 min-h-0 flex flex-col md:flex-row items-center justify-left">

                <SidebarWithResizer
                    activePanel={activeSection}
                    accountId={accountId}
                    masterPassword={masterPassword}
                    account={account}
                    activeVaultId={activeVaultId}
                    onPanelChange={handleSectionChange}
                    onOpenCreateVaultModal={() => setCreateVaultModalOpen(true)}
                />

                <Content
                    key={`${accountId}:${sessionRevision.current}`}
                    activeSection={activeSection}
                    accountId={accountId}
                    masterPassword={masterPassword}
                    vaultId={vaultId}
                    account={account}
                    onSubmitForm={onSubmitForm}
                    onSectionChange={handleSectionChange}
                    onAccountUpdated={() => syncAccount(accountId)}
                />

            </div>
            
        </div>
    )

}

export default Page
