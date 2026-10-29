import { useState, type SubmitEvent } from "react"
import { useI18n } from "@logic/i18n"
import { localMigrationAccounts, prepareLocalMigration } from "@logic/company-migration"
import { companyApi } from "@logic/company-client"

export default function CompanyMigration({ onDone, onClose }: { onDone: () => Promise<void>; onClose: () => void }) {
    const { t } = useI18n()
    const [accounts] = useState(localMigrationAccounts)
    const [selected, setSelected] = useState(accounts[0]?.id ?? "")
    const [password, setPassword] = useState("")
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const submit = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        setBusy(true)
        setMessage("")
        try {
            const data = await prepareLocalMigration(selected, password)
            setPassword("")
            const result = await companyApi<{ alreadyImported: boolean }>("/import", "POST", data)
            setMessage(
                t(
                    result.alreadyImported
                        ? "This local account was already imported. Your original data is still available."
                        : "Local data imported. Your original browser data was preserved."
                )
            )
            await onDone()
        } catch (error) {
            setMessage(t(error instanceof Error ? error.message : "Could not complete the operation. Please retry."))
        } finally {
            setBusy(false)
        }
    }
    return (
        <section className="cw-dialog-body">
            <p className="cw-dialog-description">
                {t(
                    "The old master password is used only in this browser to import previous data. It is not sent to the server. New vaults use your Google identity."
                )}
            </p>
            {accounts.length ? (
                <form
                    onSubmit={(event) => {
                        void submit(event)
                    }}
                    className="cw-form-grid"
                >
                    <label className="cw-field cw-field-wide">
                        <span>{t("Local account")}</span>
                        <select
                            className="cw-input"
                            value={selected}
                            disabled={busy}
                            onChange={(event) => setSelected(event.target.value)}
                        >
                            {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                    {account.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="cw-field cw-field-wide">
                        <span>{t("Previous master password")}</span>
                        <input
                            className="cw-input"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                            disabled={busy}
                        />
                    </label>
                    <button type="submit" className="cw-button cw-button-primary cw-field-wide" disabled={busy}>
                        {busy ? t("Importing…") : t("Import")}
                    </button>
                </form>
            ) : (
                <p>
                    {t(
                        "There are no local accounts in this browser. To migrate another browser, restore your encrypted backup in local mode first."
                    )}
                </p>
            )}
            {message && (
                <p role="status" className="cw-dialog-description">
                    {message}
                </p>
            )}
            <div className="cw-form-foot">
                <button type="button" className="cw-button" disabled={busy} onClick={onClose}>
                    {t("Close")}
                </button>
            </div>
        </section>
    )
}
