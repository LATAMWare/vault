export type VaultRole = "owner" | "admin" | "editor" | "reader"
export interface CompanyUser {
    id: string
    email: string
    isAdmin: boolean
}
export interface CompanyVault {
    id: string
    name: string
    role: VaultRole
    version: number
    updatedAt: number
    itemCount: number
}
export interface ItemContent {
    kind: "password" | "note"
    title: string
    username: string
    password: string
    url: string
    notes: string
}
export interface CompanyItem extends ItemContent {
    id: string
    version: number
    updatedAt: number
}
export interface VaultDetail extends CompanyVault {
    items: CompanyItem[]
}
export interface CompanyMember {
    id: string
    email: string
    role: VaultRole
    pending: boolean
}
export interface AuditEntry {
    id: number
    action: string
    actor: string
    target: string
    createdAt: number
}
