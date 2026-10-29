import { useEffect, useState } from "react"
import { genServicePassword, CURRENT_PASSWORD_ALGORITHM } from "@logic/utils"
import { t } from "@logic/i18n"

const questions = [
    ["How does Vault generate my passwords?", "New services use PBKDF2-SHA-256 with 600,000 iterations and HMAC-SHA-256. The master password, identifier, alphabet and rotation version determine the result. Existing legacy services keep their original algorithm until you explicitly rotate them."],
    ["Where is my information stored?", "Account data is stored in this browser. Secret contents, descriptions and preserved passwords are encrypted; names and service metadata are visible locally. Clearing browser data without a backup can permanently remove your vault."],
    ["What happens when I change the master password?", "Vault reencrypts your secrets and preserves existing service passwords under the new master password. The confirmation lets you close other tabs of the same account or keep them open. Other devices and browser profiles are independent."],
    ["How do I rotate a service password?", "Increase its rotation version or change its generation inputs, then update the password at the external service. Renaming a service does not rotate its password. Changing a legacy service's generation inputs upgrades it to the current generator."],
    ["How do backups work?", "Export creates an encrypted .vault file. New backups use authenticated AES-GCM encryption. Import validates the entire file before replacing account data and can migrate older backups. Keep a backup and verify that you can restore it."],
    ["Does Google Drive synchronize my team?", "Google Drive provides optional encrypted snapshot backups. Push and pull replace snapshots; they do not merge simultaneous edits or provide team permissions. Your deployment needs its own Google OAuth client."],
    ["Can I recover a forgotten master password?", "There is no password recovery service. Keep your master password safely and retain the passwords needed to open older backups. An administrator cannot recover a local vault on your behalf."],
    ["Can I use the Chrome extension?", "The extension must support the account's generation algorithm, verifier format and preserved passwords. Vault checks compatibility before sending current-format data. The extension is installed and maintained separately."],
    ["What does master password verification do?", "When enabled, a salted verifier checks the password before unlocking. Disabling verification skips that check; it does not remove encryption or make an incorrect password able to decrypt saved secrets."],
    ["Is this a shared company vault?", "This version manages local browser accounts. Shared vaults, organization permissions, central audit logs and cross-device session revocation require a separate backend and identity system."]
] as const

const PasswordDemo = () => {
    const [identifier, setIdentifier] = useState("example-service")
    const [master, setMaster] = useState("example passphrase")
    const [characters, setCharacters] = useState("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!")
    const [length, setLength] = useState(16)
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    useEffect(() => {
        let active = true
        setPassword(""); setError("")
        if (!identifier || !master || !characters || !Number.isInteger(length) || length < 1 || length > 64) { setLoading(false); return }
        setLoading(true)
        const timer = setTimeout(() => {
            genServicePassword(master, identifier, length, { identifier: "demo", characters }, 1, CURRENT_PASSWORD_ALGORITHM)
                .then(value => { if (active) setPassword(value) })
                .catch(() => { if (active) setError("Could not generate the demonstration password") })
                .finally(() => { if (active) setLoading(false) })
        }, 250)
        return () => { active = false; clearTimeout(timer) }
    }, [identifier, master, characters, length])
    return (
        <div className="mt-6 space-y-4 rounded-xl border border-white/10 p-4">
            <h3 className="text-xl font-inter-bold">{t("Try password generation")}</h3>
            <p className="text-sm text-white/60">{t("Use fictitious values for this demonstration. Nothing entered here is saved.")}</p>
            <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">{t("Identifier")}<input className="rounded-lg border border-white/20 bg-white/5 p-2" value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>
                <label className="flex flex-col gap-2">{t("Master Password")}<input type="password" className="rounded-lg border border-white/20 bg-white/5 p-2" value={master} onChange={event => setMaster(event.target.value)} /></label>
                <label className="flex flex-col gap-2">{t("Characters")}<input className="rounded-lg border border-white/20 bg-white/5 p-2" value={characters} onChange={event => setCharacters(event.target.value)} /></label>
                <label className="flex flex-col gap-2">{t("Password Length")}<input type="number" min={1} max={64} className="rounded-lg border border-white/20 bg-white/5 p-2" value={length} onChange={event => setLength(Number(event.target.value))} /></label>
            </div>
            <div role="status" className="break-all rounded-lg border border-primary/30 bg-primary/10 p-4">{loading ? t("Generating...") : error ? t(error) : password || t("Enter values to generate a password")}</div>
        </div>
    )
}

const FAQ = () => {
    const [active, setActive] = useState<number | null>(null)
    return (
        <section className="relative h-full w-full overflow-y-auto rounded-2xl border border-white/10 bg-white/2 p-5 md:p-10">
            <div className="mx-auto max-w-4xl">
                <h2 className="mb-6 text-2xl font-inter-black md:text-4xl">{t("Frequently Asked Questions")}</h2>
                <div className="space-y-3">
                    {questions.map(([question, answer], index) => (
                        <div key={question} className="rounded-xl border border-white/10 bg-white/2">
                            <button type="button" aria-expanded={active === index} aria-controls={`faq-answer-${index}`} onClick={() => setActive(active === index ? null : index)} className="flex w-full cursor-pointer items-center justify-between gap-4 p-4 text-left font-inter-bold">
                                {t(question)}<span aria-hidden="true">{active === index ? "−" : "+"}</span>
                            </button>
                            {active === index && <div id={`faq-answer-${index}`} className="px-4 pb-4 leading-7 text-white/75"><p>{t(answer)}</p>{index === 0 && <PasswordDemo />}</div>}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

export default FAQ
