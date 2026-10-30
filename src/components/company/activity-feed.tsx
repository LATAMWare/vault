import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { companyApi, CompanyApiError } from "@logic/company-client"
import { useI18n } from "@logic/i18n"
import Dropdown from "@component/global/dropdown"
import { auditNames } from "@logic/audit-labels"
import type { AuditEntry } from "../../interfaces/company"

type Page = { entries: AuditEntry[]; total: number; page: number; pages: number; asOf: number }
const emptyPage: Page = { entries: [], total: 0, page: 1, pages: 1, asOf: 0 }
export default function ActivityFeed({ vaultId }: { vaultId?: string }) {
    const { t, language } = useI18n()
    const [data, setData] = useState<Page>(emptyPage),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("")
    const [query, setQuery] = useState(""),
        [filter, setFilter] = useState(""),
        [action, setAction] = useState("")
    const pending = useRef<AbortController | null>(null)
    const base = vaultId ? `/vaults/${encodeURIComponent(vaultId)}/audit/events` : "/admin/audit/events"
    const load = async (number = 1, snapshot?: number) => {
        pending.current?.abort()
        const controller = new AbortController()
        pending.current = controller
        setBusy(true)
        setError("")
        const params = new URLSearchParams({ q: filter, action, page: String(number) })
        if (snapshot !== undefined) params.set("asOf", String(snapshot))
        try {
            const page = await companyApi<Page>(`${base}?${params}`, "GET", undefined, controller.signal)
            if (controller.signal.aborted) return
            setData(page)
        } catch (reason) {
            if (controller.signal.aborted) return
            if (reason instanceof CompanyApiError && reason.status === 401) {
                window.location.replace("/login")
                return
            }
            if (reason instanceof CompanyApiError && [403, 404].includes(reason.status)) setData(emptyPage)
            setError(reason instanceof Error ? reason.message : "Could not complete the operation. Please retry.")
        } finally {
            if (!controller.signal.aborted) setBusy(false)
        }
    }
    useEffect(() => {
        setData(emptyPage)
        void load()
        return () => pending.current?.abort()
    }, [base, filter, action])
    useEffect(() => {
        const timer = setTimeout(() => setFilter(query.trim()), 250)
        return () => clearTimeout(timer)
    }, [query])
    const keyboard = (event: KeyboardEvent<HTMLDetailsElement>) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        event.currentTarget.open = true
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]"))
        const current = options.indexOf(document.activeElement as HTMLButtonElement)
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : current < 0
                    ? Math.max(
                          0,
                          options.findIndex((option) => option.getAttribute("aria-selected") === "true")
                      )
                    : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
        options[next]?.focus()
    }
    return (
        <section className="cw-activity-feed" aria-label={t("Activity history")} aria-busy={busy}>
            <div className="cw-activity-filters">
                <label className="cw-field">
                    <span>{t("User or item")}</span>
                    <input
                        className="cw-input"
                        type="search"
                        value={query}
                        maxLength={200}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t("Search activity")}
                    />
                </label>
                <div className="cw-field">
                    <span>{t("Action")}</span>
                    <Dropdown
                        label={t("Filter by action")}
                        popupRole="listbox"
                        className="cw-action-dropdown"
                        triggerClassName="cw-input cw-action-trigger"
                        onKeyDown={keyboard}
                        trigger={
                            <>
                                <span>{t(auditNames[action] ?? "All actions")}</span>
                                <i className="ti ti-chevron-down" aria-hidden="true" />
                            </>
                        }
                    >
                        <div className="cw-action-popover" role="listbox" aria-label={t("Action")}>
                            {[["", "All actions"], ...Object.entries(auditNames)].map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    role="option"
                                    aria-selected={action === value}
                                    onClick={(event) => {
                                        setAction(value)
                                        event.currentTarget.closest("details")!.open = false
                                        event.currentTarget.closest("details")!.querySelector("summary")?.focus()
                                    }}
                                >
                                    {t(label)}
                                    {action === value && <i className="ti ti-check" aria-hidden="true" />}
                                </button>
                            ))}
                        </div>
                    </Dropdown>
                </div>
                <button
                    className="cw-icon-button"
                    type="button"
                    aria-label={t("Refresh activity")}
                    onClick={() => void load()}
                    disabled={busy}
                >
                    <i className="ti ti-refresh" aria-hidden="true" />
                </button>
            </div>
            {error && (
                <p role="alert" className="cw-danger-text">
                    {t(error)}
                </p>
            )}
            <div className="cw-table-wrap" role="region" aria-label={t("Activity history")} tabIndex={0}>
                <table className="cw-table cw-audit-table">
                    <caption className="sr-only">{t("Activity")}</caption>
                    <thead>
                        <tr>
                            <th scope="col">{t("Date")}</th>
                            <th scope="col">{t("Action")}</th>
                            <th scope="col">{t("User")}</th>
                            <th scope="col">{t("Affected item")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.entries.map((entry) => (
                            <tr key={entry.id}>
                                <td>{new Date(entry.createdAt).toLocaleString(language)}</td>
                                <td>{t(auditNames[entry.action] ?? entry.action)}</td>
                                <td>{entry.actor}</td>
                                <td>{entry.target}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!busy && !data.entries.length && (
                <p className="cw-dialog-description">{t("No activity matches these filters.")}</p>
            )}
            <div className="cw-activity-pagination">
                <span role="status">
                    {t("Showing {{shown}} of {{total}} events", { shown: data.entries.length, total: data.total })}
                </span>
                <div className="cw-page-controls">
                    <button
                        className="cw-icon-button"
                        aria-label={t("Previous page")}
                        disabled={busy || data.page <= 1}
                        onClick={() => void load(data.page - 1, data.asOf)}
                    >
                        <i className="ti ti-chevron-left" aria-hidden="true" />
                    </button>
                    <span>{t("Page {{page}} of {{pages}}", { page: data.page, pages: data.pages })}</span>
                    <button
                        className="cw-icon-button"
                        aria-label={t("Next page")}
                        disabled={busy || data.page >= data.pages}
                        onClick={() => void load(data.page + 1, data.asOf)}
                    >
                        <i className="ti ti-chevron-right" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </section>
    )
}
