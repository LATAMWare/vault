export type InstallPrompt = Event & { prompt(): Promise<{ outcome: "accepted" | "dismissed" }> }
let prompt: InstallPrompt | null = null
let started = false
let installed = false
let checking: Promise<void> | undefined
const installedKey = "vault:pwa-installed"
const displayMode = "(display-mode: standalone), (display-mode: window-controls-overlay)"
const inApp = () =>
    Boolean(window.matchMedia?.(displayMode).matches || (navigator as Navigator & { standalone?: boolean }).standalone)
export const isPwaInstalled = () => {
    if (typeof window === "undefined") return false
    if (installed || inApp()) return true
    try {
        return window.localStorage.getItem(installedKey) === "1"
    } catch {
        return false
    }
}
export function markPwaInstalled() {
    installed = true
    prompt = null
    try {
        window.localStorage.setItem(installedKey, "1")
    } catch {
        /* Storage can be unavailable in private browsing. */
    }
    window.dispatchEvent(new window.Event("vault:installed"))
}
function refreshInstallation() {
    if (inApp()) {
        markPwaInstalled()
        return
    }
    const related = navigator as Navigator & {
        getInstalledRelatedApps?: () => Promise<{ platform: string; id?: string; url?: string }[]>
    }
    if (!related.getInstalledRelatedApps || checking) return
    checking = related
        .getInstalledRelatedApps()
        .then((apps) => {
            const ownApp = apps.some((app) => {
                if (app.platform !== "webapp") return false
                try {
                    return (
                        (app.id !== undefined &&
                            new URL(app.id, window.location.origin).href ===
                                new URL("/", window.location.origin).href) ||
                        (app.url !== undefined &&
                            new URL(app.url, window.location.origin).href ===
                                new URL("/manifest.webmanifest", window.location.origin).href)
                    )
                } catch {
                    return false
                }
            })
            if (ownApp) markPwaInstalled()
        })
        .catch(() => {})
        .finally(() => {
            checking = undefined
        })
}
export const getInstallPrompt = () => prompt
export function setupPwa() {
    if (started || typeof window === "undefined") return
    started = true
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault()
        // A new browser install offer supersedes a remembered installation (e.g. after uninstalling).
        installed = false
        try {
            window.localStorage.removeItem(installedKey)
        } catch {}
        prompt = event as InstallPrompt
        window.dispatchEvent(new window.Event("vault:installable"))
    })
    window.addEventListener("appinstalled", () => {
        markPwaInstalled()
    })
    window.addEventListener("storage", (event) => {
        if (event.key !== installedKey && event.key !== null) return
        installed = event.newValue === "1"
        window.dispatchEvent(new window.Event("vault:installed"))
    })
    window.addEventListener("focus", refreshInstallation)
    window.matchMedia?.(displayMode).addEventListener?.("change", refreshInstallation)
    refreshInstallation()
    if ("serviceWorker" in navigator && window.isSecureContext) {
        const register = () => {
            void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {})
        }
        if (document.readyState === "complete") register()
        else window.addEventListener("load", register, { once: true })
    }
}
export const clearInstallPrompt = () => {
    prompt = null
}
