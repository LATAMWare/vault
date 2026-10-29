export interface IService {
    id: string
    name: string
    icon: string
    description: string
    url: string
    identifier: string
    alphabet: string
    length: number
    vault: string
    version: number
    algorithm?: "legacy" | "pbkdf2-v2"
    // Preserved when rotating the master password; encrypted under the new master.
    password?: string
}
