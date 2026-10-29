import { useEffect, useId, useRef, type ReactNode } from "react"
import { useI18n } from "@logic/i18n"

export default function CompanyDialog({
    title,
    children,
    onClose,
    wide = false,
    navigation = false,
    returnFocus
}: {
    title: string
    children: ReactNode
    onClose: () => void
    wide?: boolean
    navigation?: boolean
    returnFocus?: HTMLElement | null
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const id = useId()
    const { t } = useI18n()
    useEffect(() => {
        const dialog = ref.current!
        dialog.showModal()
        dialog
            .querySelector<HTMLElement>(
                "[data-dialog-autofocus],input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]),textarea:not([disabled]),select:not([disabled])"
            )
            ?.focus()
        const trigger = returnFocus ?? (document.activeElement as HTMLElement | null)
        return () => {
            if (dialog.open) dialog.close()
            window.requestAnimationFrame(() => {
                if (trigger?.isConnected && !trigger.hasAttribute("disabled")) trigger.focus()
                else document.querySelector<HTMLElement>("[data-company-mobile-menu]")?.focus()
            })
        }
    }, [])
    return (
        <dialog
            ref={ref}
            className={`cw-dialog ${wide ? "cw-dialog-wide" : ""} ${navigation ? "cw-navigation-dialog" : ""}`}
            aria-labelledby={id}
            onKeyDown={(event) => {
                if (event.key !== "Tab") return
                const items = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                        "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex='0']"
                    )
                ).filter((element) => element.getClientRects().length > 0)
                const first = items[0],
                    last = items.at(-1)
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault()
                    last?.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault()
                    first?.focus()
                }
            }}
            onCancel={(event) => {
                event.preventDefault()
                onClose()
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose()
            }}
        >
            <div className="cw-dialog-panel">
                <header className="cw-dialog-header">
                    <h2 id={id}>{title}</h2>
                    <button type="button" className="cw-icon-button" aria-label={t("Close")} onClick={onClose}>
                        <i className="ti ti-x" aria-hidden="true" />
                    </button>
                </header>
                {children}
            </div>
        </dialog>
    )
}
