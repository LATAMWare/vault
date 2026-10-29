export interface PasswordChangeNotice {
    accountId: string
    revision: string
    closeOtherSessions: boolean
    // Ephemeral: encrypted with the old password, never persisted in browser storage or backups.
    handoff?: string
}

const CHANNEL = "latamware-vault-sessions-v1"
export const announceMasterPasswordChange = (notice: PasswordChangeNotice) => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return
    try {
        const channel = new BroadcastChannel(CHANNEL)
        channel.postMessage(notice)
        channel.close()
    } catch {
        // A notification failure must not misreport an already committed password change.
        // Revocation is also enforced through the persisted revision and storage events.
    }
}

export const watchPasswordChanges = (listener: (notice: PasswordChangeNotice) => void) => {
    if (typeof BroadcastChannel === "undefined") return () => {}
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = event => {
        const value = event.data
        if (value && typeof value.accountId === "string" && typeof value.revision === "string" && typeof value.closeOtherSessions === "boolean") listener(value)
    }
    return () => channel.close()
}
