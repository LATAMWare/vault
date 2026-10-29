import { useEffect, useState, type SubmitEvent } from "react"
import LanguageSelector from "@component/global/language-selector"
import { detectLanguage, setLanguage, useI18n } from "@logic/i18n"

export default function Logout() {
    const { language, t } = useI18n()
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)
    useEffect(() => { void setLanguage(detectLanguage(), false) }, [])
    useEffect(() => { document.title = `${t("Sign out")} - LATAMWare Vault` }, [language])

    const signOut = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        setPending(true)
        setFailed(false)
        try {
            const response = await fetch("/api/auth/csrf", { cache: "no-store" })
            const data = await response.json()
            if (!response.ok || typeof data.csrfToken !== "string") throw new Error("CSRF unavailable")
            const input = form.elements.namedItem("csrfToken") as HTMLInputElement
            input.value = data.csrfToken
            form.submit()
        } catch { setFailed(true); setPending(false) }
    }

    return (
        <main className="relative z-10 min-h-screen flex items-center justify-center p-6">
            <section className="w-full max-w-md rounded-2xl border border-white/15 bg-black/40 p-8 backdrop-blur-xl text-white">
                <h1 className="text-2xl font-bold">{t("Sign out")}</h1>
                <p className="mt-4 text-white/75">{t("Are you sure you want to sign out?")}</p>
                <p className="mt-2 mb-6 text-sm text-white/60">{t("This signs you out of LATAMWare Vault on this browser.")}</p>
                {failed && <p role="alert" className="mb-4 text-red-300">{t("Could not sign out. Check your connection and try again.")}</p>}
                <form method="post" action="/api/auth/signout" onSubmit={signOut}>
                    <input type="hidden" name="csrfToken" />
                    <input type="hidden" name="callbackUrl" value="/login" />
                    <button type="submit" disabled={pending} className="w-full rounded-lg border border-white/25 p-3 hover:bg-white/10 disabled:opacity-50 cursor-pointer">
                        {pending ? t("Signing out…") : t("Sign out")}
                    </button>
                </form>
                <a href="/" className="mt-4 block text-center underline">{t("Cancel")}</a>
                <div className="mt-6"><LanguageSelector /></div>
            </section>
        </main>
    )
}
