import { useEffect, useState, type SubmitEvent } from "react"
import LanguageSelector from "@component/global/language-selector"
import { detectLanguage, setLanguage, useI18n } from "@logic/i18n"
import { getLoginError, type LoginError } from "@logic/login-error"

export default function Login({ errorCode = null }: { errorCode?: string | null }) {
    const { t } = useI18n()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<LoginError | null>(() => getLoginError(errorCode))
    useEffect(() => {
        void setLanguage(detectLanguage(), false)
        // Consume the result of this attempt so refresh/bookmarks do not replay old errors.
        const url = new URL(window.location.href)
        if (url.searchParams.has("error")) {
            url.searchParams.delete("error")
            window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
        }
    }, [])

    const errorMessage = () => {
        switch (error) {
            case "access-denied": return t("Your Google account is not authorized. Contact the administrator.")
            case "expired-attempt": return t("Your sign-in attempt expired. Please try again.")
            case "configuration": return t("Google sign-in is not configured correctly. Contact the administrator.")
            case "google": return t("Google could not complete sign-in. Please try again.")
            case "connection": return t("Could not start sign-in. Check your connection and try again.")
            default: return ""
        }
    }

    const signIn = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        setPending(true)
        setError(null)
        try {
            const response = await fetch("/api/auth/csrf", { cache: "no-store" })
            if (response.status === 503) { setError("configuration"); setPending(false); return }
            const data = await response.json()
            if (!response.ok || typeof data.csrfToken !== "string") throw new Error("CSRF unavailable")
            const input = form.elements.namedItem("csrfToken") as HTMLInputElement
            input.value = data.csrfToken
            form.submit()
        } catch { setError("connection"); setPending(false) }
    }

    return (
        <main className="relative z-10 min-h-screen flex items-center justify-center p-6">
            <section className="w-full max-w-md rounded-2xl border border-white/15 bg-black/40 p-8 backdrop-blur-xl text-white">
                <h1 className="text-2xl font-bold">LATAMWare Vault</h1>
                <p className="mt-4 mb-6 text-white/75">{t("Sign in with your authorized Google account.")}</p>
                {error && <p role="alert" className="mb-4 text-red-300">{errorMessage()}</p>}
                <form method="post" action="/api/auth/signin/google" onSubmit={signIn}>
                    <input type="hidden" name="csrfToken" />
                    <input type="hidden" name="callbackUrl" value="/" />
                    <button type="submit" disabled={pending} className="w-full rounded-lg border border-white/25 p-3 hover:bg-white/10 disabled:opacity-50 cursor-pointer">
                        {pending ? t("Connecting to Google…") : t("Continue with Google")}
                    </button>
                </form>
                <div className="mt-6"><LanguageSelector /></div>
            </section>
        </main>
    )
}
