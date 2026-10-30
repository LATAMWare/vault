export type InstallPrompt = Event & { prompt(): Promise<{ outcome: "accepted" | "dismissed" }> }
let prompt: InstallPrompt | null = null
let started = false
export const getInstallPrompt = () => prompt
export function setupPwa() {
    if (started || typeof window === "undefined") return
    started = true
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault()
        prompt = event as InstallPrompt
        window.dispatchEvent(new window.Event("vault:installable"))
    })
    window.addEventListener("appinstalled", () => {
        prompt = null
        window.dispatchEvent(new window.Event("vault:installed"))
    })
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
