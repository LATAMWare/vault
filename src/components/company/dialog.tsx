import { useEffect, useId, useRef, type ReactNode } from "react"
import { useI18n } from "@logic/i18n"

export default function CompanyDialog({
    title,
    children,
    onClose,
    wide = false,
    navigation = false,
    open = true,
    autoFocusField = true,
    returnFocus
}: {
    title: string
    children: ReactNode
    onClose: () => void
    wide?: boolean
    navigation?: boolean
    open?: boolean
    autoFocusField?: boolean
    returnFocus?: HTMLElement | null
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const lastFocus = useRef<HTMLElement | null>(null)
    const hasOpened = useRef(false)
    const id = useId()
    const { t } = useI18n()
    const restoreFocus = () => {
        window.requestAnimationFrame(() => {
            if (document.querySelector("dialog[open]")) return
            const trigger = lastFocus.current
            if (trigger?.isConnected && !trigger.hasAttribute("disabled")) trigger.focus()
            else document.querySelector<HTMLElement>("[data-company-mobile-menu]")?.focus()
        })
    }
    useEffect(() => {
        const dialog = ref.current!
        let timer: ReturnType<typeof setTimeout> | undefined
        if (open) {
            lastFocus.current = returnFocus ?? (document.activeElement as HTMLElement | null)
            hasOpened.current = true
            dialog.removeAttribute("data-closing")
            if (!dialog.open) dialog.showModal()
            if (autoFocusField)
                dialog
                    .querySelector<HTMLElement>(
                        "[data-dialog-autofocus],input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([disabled]),textarea:not([disabled]),select:not([disabled])"
                    )
                    ?.focus()
        } else if (dialog.open) {
            const finish = () => {
                dialog.close()
                dialog.removeAttribute("data-closing")
                hasOpened.current = false
                restoreFocus()
            }
            if (navigation && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
                dialog.setAttribute("data-closing", "true")
                timer = setTimeout(finish, 200)
            } else finish()
        }
        return () => clearTimeout(timer)
    }, [open])
    useEffect(() => {
        const dialog = ref.current!
        return () => {
            if (dialog.open) dialog.close()
            if (hasOpened.current) restoreFocus()
        }
    }, [])
    return (
        <dialog
            ref={ref}
            id={navigation ? "company-mobile-navigation" : undefined}
            className={`cw-dialog ${wide ? "cw-dialog-wide" : ""} ${navigation ? "cw-navigation-dialog" : ""}`}
            aria-labelledby={id}
            onKeyDown={(event) => {
                if ((event.target as HTMLElement).closest("dialog") !== event.currentTarget) return
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
                event.stopPropagation()
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
