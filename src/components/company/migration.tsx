import { useState, type SubmitEvent } from "react"
import { setLanguage, useI18n } from "@logic/i18n"
import { localMigrationAccounts, prepareLocalBackup, prepareLocalMigration } from "@logic/company-migration"
import { BACKUP_LIMIT, decryptCompanyBackup, encryptCompanyBackup, type CompanyBackup } from "@logic/company-backup"
import { companyApi } from "@logic/company-client"
import { downloadFile } from "@logic/utils"
import type { CompanyVault } from "../../interfaces/company"

type Source = "browser" | "file" | "export"
export default function CompanyMigration({
    vaults,
    onDone,
    onClose
}: {
    vaults: CompanyVault[]
    onDone: () => Promise<void>
    onClose: () => void
}) {
    const { t, language } = useI18n()
    const [accounts] = useState(localMigrationAccounts)
    const [source, setSource] = useState<Source>("browser")
    const [selected, setSelected] = useState(accounts[0]?.id ?? "")
    const [selectedVaults, setSelectedVaults] = useState<string[]>(vaults.map((vault) => vault.id))
    const [file, setFile] = useState<File | null>(null)
    const [password, setPassword] = useState("")
    const [confirmation, setConfirmation] = useState("")
    const [restoreLanguage, setRestoreLanguage] = useState(true)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const [error, setError] = useState("")
    const changeSource = (value: Source) => {
        setSource(value)
        setPassword("")
        setConfirmation("")
        setMessage("")
        setError("")
        setFile(null)
    }
    const submit = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setMessage("")
        setError("")
        try {
            if (source === "export") {
                if (password !== confirmation) throw new Error(t("Backup passwords do not match."))
                const data = await companyApi<CompanyBackup>("/export", "POST", {
                    vaultIds: selectedVaults
                })
                const encrypted = await encryptCompanyBackup(data, password, language)
                downloadFile(
                    encrypted,
                    `latamware-${new Date().toISOString().slice(0, 10)}.latamvault`,
                    "application/octet-stream"
                )
                setMessage(t("Encrypted backup downloaded. Keep its password in a safe place."))
            } else {
                let preferences: CompanyBackup["preferences"]
                let data: Awaited<ReturnType<typeof prepareLocalMigration>>
                if (source === "browser") data = await prepareLocalMigration(selected, password)
                else {
                    if (!file || file.size > BACKUP_LIMIT) throw new Error(t("Choose a backup smaller than 6 MiB."))
                    const contents = (await file.text()).trim()
                    if (file.name.toLowerCase().endsWith(".latamvault")) {
                        const backup = await decryptCompanyBackup(contents, password)
                        data = backup
                        preferences = backup.preferences
                    } else if (file.name.toLowerCase().endsWith(".vault"))
                        data = await prepareLocalBackup(contents, password)
                    else throw new Error(t("Choose a .vault or .latamvault backup."))
                }
                const result = await companyApi<{ alreadyImported: boolean }>("/import", "POST", data)
                if (restoreLanguage && preferences?.language) await setLanguage(preferences.language)
                await onDone()
                setMessage(
                    t(
                        result.alreadyImported
                            ? "This data was already imported. Existing vaults were not duplicated."
                            : "Data imported into new private vaults. Share them when you are ready."
                    )
                )
            }
            setPassword("")
            setConfirmation("")
        } catch (reason) {
            setError(t(reason instanceof Error ? reason.message : "Could not complete the operation. Please retry."))
        } finally {
            setBusy(false)
        }
    }
    const steps =
        source === "browser"
            ? [
                  "Open this site in the browser and address where your local account was stored.",
                  "Choose the old local account and enter its previous master password.",
                  "Import creates new private vaults. Your browser data stays untouched; share the new vaults afterwards."
              ]
            : source === "file"
              ? [
                    "For old local data, open the original app, unlock the account and go to Settings → Export data to download its .vault file.",
                    "Choose that .vault file or a .latamvault backup made here, and enter the password used for that backup.",
                    "Import creates new private vaults without replacing existing ones. Importing the same backup again does not duplicate it."
                ]
              : [
                    "Select the vaults you want to back up. You can only export vaults you can access.",
                    "Choose a backup password of at least 12 characters. The file is encrypted in this browser before download.",
                    "Keep the .latamvault file and its password separately. Restore it from the Import file tab."
                ]
    return (
        <section className="cw-dialog-body">
            <div className="cw-transfer-switch" role="group" aria-label={t("Data transfer method")}>
                {(
                    [
                        ["browser", "From this browser"],
                        ["file", "Import file"],
                        ["export", "Export backup"]
                    ] as const
                ).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        className="cw-button"
                        aria-pressed={source === value}
                        disabled={busy}
                        onClick={() => changeSource(value)}
                    >
                        {t(label)}
                    </button>
                ))}
            </div>
            <ol className="cw-transfer-guide">
                {steps.map((step) => (
                    <li key={step}>{t(step)}</li>
                ))}
            </ol>
            <p className="cw-dialog-description">
                {t(
                    source === "export"
                        ? "Includes passwords, usernames, notes, URLs and language. Sharing permissions, pinned items, activity, Google sessions and server configuration are not included."
                        : "The password is used only in this browser to decrypt the backup. It is not sent to the server. Imported vaults initially belong only to you."
                )}
            </p>
            {source === "browser" && !accounts.length ? (
                <p className="cw-transfer-empty">
                    {t(
                        "No local accounts were found at this address. Use Import file to bring a backup from another browser or address."
                    )}
                </p>
            ) : (
                <form
                    onSubmit={(event) => {
                        void submit(event)
                    }}
                    className="cw-form-grid"
                >
                    {source === "browser" && (
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
                    )}
                    {source === "file" && (
                        <>
                            <label className="cw-field cw-field-wide">
                                <span>{t("Encrypted backup file")}</span>
                                <input
                                    className="cw-input"
                                    type="file"
                                    accept=".vault,.latamvault"
                                    required
                                    disabled={busy}
                                    onChange={(event) => {
                                        setFile(event.target.files?.[0] ?? null)
                                        setError("")
                                        setMessage("")
                                    }}
                                />
                            </label>
                            <label className="cw-transfer-check cw-field-wide">
                                <input
                                    type="checkbox"
                                    checked={restoreLanguage}
                                    disabled={busy}
                                    onChange={(event) => setRestoreLanguage(event.target.checked)}
                                />
                                {t("Restore language preference when included")}
                            </label>
                        </>
                    )}
                    {source === "export" && (
                        <fieldset className="cw-transfer-vaults cw-field-wide" disabled={busy}>
                            <legend>{t("Vaults to export")}</legend>
                            {vaults.length ? (
                                vaults.map((vault) => (
                                    <label className="cw-transfer-check" key={vault.id}>
                                        <input
                                            type="checkbox"
                                            checked={selectedVaults.includes(vault.id)}
                                            onChange={(event) =>
                                                setSelectedVaults((ids) =>
                                                    event.target.checked
                                                        ? [...ids, vault.id]
                                                        : ids.filter((id) => id !== vault.id)
                                                )
                                            }
                                        />
                                        {vault.name}
                                        <small>
                                            {vault.itemCount} {t(vault.itemCount === 1 ? "Item" : "Items")}
                                        </small>
                                    </label>
                                ))
                            ) : (
                                <p>{t("No vaults available to export.")}</p>
                            )}
                        </fieldset>
                    )}
                    <label className="cw-field cw-field-wide">
                        <span>{t(source === "browser" ? "Previous master password" : "Backup password")}</span>
                        <input
                            className="cw-input"
                            type="password"
                            autoComplete={source === "export" ? "new-password" : "off"}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                            minLength={source === "export" ? 12 : undefined}
                            disabled={busy}
                        />
                    </label>
                    {source === "export" && (
                        <label className="cw-field cw-field-wide">
                            <span>{t("Confirm backup password")}</span>
                            <input
                                className="cw-input"
                                type="password"
                                autoComplete="new-password"
                                value={confirmation}
                                onChange={(event) => setConfirmation(event.target.value)}
                                required
                                minLength={12}
                                disabled={busy}
                            />
                        </label>
                    )}
                    <button
                        type="submit"
                        className="cw-button cw-button-primary cw-field-wide"
                        disabled={busy || (source === "export" && !selectedVaults.length)}
                    >
                        {busy ? t("Processing…") : t(source === "export" ? "Download encrypted backup" : "Import")}
                    </button>
                </form>
            )}
            {message && (
                <p role="status" className="cw-dialog-description">
                    {message}
                </p>
            )}
            {error && (
                <p role="alert" className="cw-danger-text">
                    {error}
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
