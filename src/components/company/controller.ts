import { useEffect, useRef, useState } from "react"
import { detectLanguage, setLanguage, useI18n } from "@logic/i18n"
import { companyApi, CompanyApiError, emptyCompanyItem } from "@logic/company-client"
import type {
    AuditEntry,
    CompanyMember,
    CompanyUser,
    CompanyVault,
    ItemContent,
    VaultDetail
} from "../../interfaces/company"

export type AdminData = {
    users: { id: string; email: string; disabled: number }[]
    vaults: { id: string; name: string; owner: string }[]
    audit: AuditEntry[]
}
type Editing = { id?: string; version?: number; content: ItemContent }
export type Confirmation = {
    title: string
    description: string
    label: string
    danger?: boolean
    action: () => Promise<void>
}

export function useCompany(user: CompanyUser) {
    const { language, t } = useI18n()
    const [me, setMe] = useState(user)
    const [vaults, setVaults] = useState<CompanyVault[]>([])
    const [activeId, setActiveId] = useState("")
    const [vault, setVault] = useState<VaultDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [newVault, setNewVault] = useState(false)
    const [vaultName, setVaultName] = useState("")
    const [editing, setEditing] = useState<Editing | null>(null)
    const [revealed, setRevealed] = useState<string[]>([])
    const [sharing, setSharing] = useState(false)
    const [members, setMembers] = useState<CompanyMember[]>([])
    const [inviteEmail, setInviteEmail] = useState("")
    const [inviteRole, setInviteRole] = useState("reader")
    const [audit, setAudit] = useState<AuditEntry[] | null>(null)
    const [importing, setImporting] = useState(false)
    const [adminOpen, setAdminOpen] = useState(false)
    const [adminData, setAdminData] = useState<AdminData | null>(null)
    const [renaming, setRenaming] = useState(false)
    const [query, setQuery] = useState("")
    const [mobileNav, setMobileNav] = useState(false)
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
    const selected = useRef(activeId)
    selected.current = activeId
    const sequence = useRef(0)
    const alive = useRef(true)
    const performing = useRef(false)
    const canEdit = Boolean(vault && ["owner", "admin", "editor"].includes(vault.role))
    const canManage = Boolean(vault && ["owner", "admin"].includes(vault.role))

    useEffect(() => {
        alive.current = true
        void setLanguage(detectLanguage(), false)
        return () => {
            alive.current = false
        }
    }, [])
    useEffect(() => {
        document.title = "LATAMWare Vault"
        document.documentElement.lang = language
    }, [language])
    const failed = (reason: unknown) => {
        if (!alive.current) return
        if (reason instanceof CompanyApiError && reason.status === 401) {
            setVault(null)
            setEditing(null)
            setMembers([])
            setAdminData(null)
            window.location.replace("/login")
            return
        }
        setError(reason instanceof Error ? reason.message : "Could not complete the operation. Please retry.")
    }
    const refreshIndex = async () => {
        const data = await companyApi<{ me: CompanyUser; vaults: CompanyVault[] }>()
        if (!alive.current) return
        if (data.me.id !== user.id) throw new CompanyApiError(401, "Please sign in again.")
        setMe(data.me)
        setVaults(data.vaults)
        if (!data.me.isAdmin) {
            setAdminOpen(false)
            setAdminData(null)
        }
        setActiveId((current) => (data.vaults.some((item) => item.id === current) ? current : ""))
    }
    const refreshVault = async (id: string) => {
        const request = ++sequence.current
        const data = await companyApi<VaultDetail>(`/vaults/${encodeURIComponent(id)}`)
        if (!alive.current || selected.current !== id || request !== sequence.current) return
        setVault(data)
        if (!["owner", "admin", "editor"].includes(data.role)) setEditing(null)
        if (!["owner", "admin"].includes(data.role)) {
            setSharing(false)
            setMembers([])
            setAudit(null)
        }
    }
    const refresh = async () => {
        await refreshIndex()
        if (selected.current) await refreshVault(selected.current)
        if (adminOpen) setAdminData(await companyApi<AdminData>("/admin"))
    }
    useEffect(() => {
        let active = true
        void refreshIndex()
            .catch((reason) => {
                if (active) failed(reason)
            })
            .finally(() => {
                if (active) setLoading(false)
            })
        return () => {
            active = false
        }
    }, [])
    useEffect(() => {
        setEditing(null)
        setVault(null)
        setSharing(false)
        setMembers([])
        setAudit(null)
        setRevealed([])
        setRenaming(false)
        setQuery("")
        if (activeId) void refreshVault(activeId).catch(failed)
    }, [activeId])
    useEffect(() => {
        const poll = async () => {
            try {
                await refresh()
            } catch (reason) {
                setVault(null)
                setEditing(null)
                setMembers([])
                setAdminData(null)
                failed(reason)
            }
        }
        const focus = () => {
            void poll()
        }
        const visibility = () => {
            if (document.visibilityState === "visible") void poll()
            else setRevealed([])
        }
        const interval = window.setInterval(focus, 15000)
        window.addEventListener("focus", focus)
        document.addEventListener("visibilitychange", visibility)
        return () => {
            window.clearInterval(interval)
            window.removeEventListener("focus", focus)
            document.removeEventListener("visibilitychange", visibility)
        }
    }, [activeId, adminOpen])
    const perform = async (action: () => Promise<void>) => {
        if (performing.current) return
        performing.current = true
        setBusy(true)
        setError("")
        setNotice("")
        try {
            await action()
        } catch (reason) {
            failed(reason)
        } finally {
            setBusy(false)
            performing.current = false
        }
    }
    const selectVault = (id: string) => {
        setActiveId(id)
        setAdminOpen(false)
        setMobileNav(false)
        setError("")
        setQuery("")
    }
    const createVault = async () =>
        perform(async () => {
            const created = await companyApi<CompanyVault>("/vaults", "POST", { name: vaultName })
            await refreshIndex()
            selectVault(created.id)
            setVaultName("")
            setNewVault(false)
        })
    const saveItem = async (content: ItemContent) =>
        perform(async () => {
            const edit = editing
            await companyApi(`/vaults/${activeId}/items${edit?.id ? `/${edit.id}` : ""}`, edit?.id ? "PATCH" : "POST", {
                content,
                version: edit?.version
            })
            setEditing(null)
            await refresh()
        })
    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value)
            setNotice(t("Copied to clipboard."))
        } catch {
            failed(new Error("Could not copy. Please retry."))
        }
    }
    const loadMembers = async () => {
        setMembers(await companyApi<CompanyMember[]>(`/vaults/${activeId}/members`))
        setSharing(true)
    }
    const openAdmin = () => {
        setAdminOpen(true)
        setMobileNav(false)
        setQuery("")
        void perform(async () => setAdminData(await companyApi<AdminData>("/admin")))
    }
    const openNewVault = () => {
        setVaultName("")
        setNewVault(true)
        setMobileNav(false)
    }
    const startItem = () => setEditing({ content: emptyCompanyItem() })
    return {
        language,
        t,
        me,
        vaults,
        activeId,
        vault,
        loading,
        busy,
        error,
        notice,
        newVault,
        vaultName,
        editing,
        revealed,
        sharing,
        members,
        inviteEmail,
        inviteRole,
        audit,
        importing,
        adminOpen,
        adminData,
        renaming,
        query,
        mobileNav,
        confirmation,
        canEdit,
        canManage,
        setError,
        setNotice,
        setNewVault,
        setVaultName,
        setEditing,
        setRevealed,
        setSharing,
        setMembers,
        setInviteEmail,
        setInviteRole,
        setAudit,
        setImporting,
        setAdminOpen,
        setAdminData,
        setRenaming,
        setQuery,
        setMobileNav,
        setConfirmation,
        setVault,
        setActiveId,
        perform,
        refresh,
        refreshIndex,
        selectVault,
        createVault,
        saveItem,
        copy,
        loadMembers,
        openAdmin,
        openNewVault,
        startItem
    }
}
export type CompanyController = ReturnType<typeof useCompany>
