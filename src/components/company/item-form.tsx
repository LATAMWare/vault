import { useState, type SubmitEvent } from "react"
import { useI18n } from "@logic/i18n"
import { generateCompanyPassword } from "@logic/company-client"
import type { ItemContent } from "../../interfaces/company"

export default function CompanyItemForm({
    initial,
    busy,
    onSave,
    onCancel
}: {
    initial: ItemContent
    busy: boolean
    onSave: (item: ItemContent) => Promise<void>
    onCancel: () => void
}) {
    const { t } = useI18n()
    const [form, setForm] = useState(initial)
    const [visible, setVisible] = useState(false)
    const set = (key: keyof ItemContent, value: string) => setForm((previous) => ({ ...previous, [key]: value }))
    const submit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        void onSave(form.kind === "note" ? { ...form, password: "", username: "", url: "" } : form)
    }
    return (
        <form onSubmit={submit} className="cw-form" aria-busy={busy}>
            <fieldset className="cw-type-picker" disabled={busy}>
                <legend className="sr-only">{t("Type")}</legend>
                <label className="cw-type-choice">
                    <input
                        type="radio"
                        name="item-kind"
                        value="password"
                        checked={form.kind === "password"}
                        onChange={() => set("kind", "password")}
                    />
                    <i className="ti ti-key" aria-hidden="true" />
                    {t("Password")}
                </label>
                <label className="cw-type-choice">
                    <input
                        type="radio"
                        name="item-kind"
                        value="note"
                        checked={form.kind === "note"}
                        onChange={() => set("kind", "note")}
                    />
                    <i className="ti ti-file-text" aria-hidden="true" />
                    {t("Secure note")}
                </label>
            </fieldset>
            <div className="cw-form-grid">
                <label className="cw-field cw-field-wide">
                    <span>{t("Name")}</span>
                    <input
                        className="cw-input"
                        value={form.title}
                        placeholder={t("For example: Hosting panel")}
                        maxLength={200}
                        required
                        autoFocus
                        onChange={(event) => set("title", event.target.value)}
                        disabled={busy}
                    />
                </label>
                {form.kind === "password" && (
                    <>
                        <label className="cw-field">
                            <span>{t("Username or email")}</span>
                            <input
                                className="cw-input"
                                value={form.username}
                                maxLength={1000}
                                autoComplete="off"
                                onChange={(event) => set("username", event.target.value)}
                                disabled={busy}
                            />
                        </label>
                        <label className="cw-field">
                            <span>{t("URL")}</span>
                            <input
                                className="cw-input"
                                value={form.url}
                                placeholder="https://"
                                maxLength={2048}
                                onChange={(event) => set("url", event.target.value)}
                                disabled={busy}
                            />
                        </label>
                        <div className="cw-field cw-field-wide">
                            <label htmlFor="company-item-password">{t("Password")}</label>
                            <div className="cw-input-action">
                                <input
                                    id="company-item-password"
                                    className="cw-input"
                                    value={form.password}
                                    type={visible ? "text" : "password"}
                                    maxLength={16384}
                                    autoComplete="new-password"
                                    required
                                    onChange={(event) => set("password", event.target.value)}
                                    disabled={busy}
                                />
                                <button
                                    type="button"
                                    className="cw-icon-button"
                                    aria-label={visible ? t("Hide password") : t("Show password")}
                                    aria-pressed={visible}
                                    onClick={() => setVisible(!visible)}
                                >
                                    <i className={`ti ${visible ? "ti-eye-off" : "ti-eye"}`} aria-hidden="true" />
                                </button>
                            </div>
                            <button
                                type="button"
                                className="cw-generate"
                                disabled={busy}
                                onClick={() => set("password", generateCompanyPassword())}
                            >
                                <i className="ti ti-sparkles" aria-hidden="true" />
                                {t("Generate password")}
                            </button>
                            <span className="cw-field-hint">
                                {t("Use an existing password or generate a new one.")}
                            </span>
                        </div>
                    </>
                )}
                <label className="cw-field cw-field-wide">
                    <span>{t("Notes")}</span>
                    <textarea
                        className="cw-input"
                        rows={4}
                        maxLength={131072}
                        required={form.kind === "note"}
                        value={form.notes}
                        onChange={(event) => set("notes", event.target.value)}
                        disabled={busy}
                    />
                </label>
            </div>
            <div className="cw-form-foot">
                <button type="button" className="cw-button cw-button-quiet" onClick={onCancel} disabled={busy}>
                    {t("Cancel")}
                </button>
                <button type="submit" className="cw-button cw-button-primary" disabled={busy}>
                    <i className={`ti ${busy ? "ti-loader-2 cw-spin" : "ti-check"}`} aria-hidden="true" />
                    {busy ? t("Saving…") : t("Save")}
                </button>
            </div>
        </form>
    )
}
