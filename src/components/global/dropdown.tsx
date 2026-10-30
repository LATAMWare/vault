import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react"

export default function Dropdown({
    label,
    trigger,
    children,
    className = "",
    triggerClassName = "",
    onKeyDown,
    popupRole,
    floating = false
}: {
    label: string
    trigger: ReactNode
    children: ReactNode
    className?: string
    triggerClassName?: string
    onKeyDown?: (event: KeyboardEvent<HTMLDetailsElement>) => void
    popupRole?: "listbox" | "menu"
    floating?: boolean
}) {
    const ref = useRef<HTMLDetailsElement>(null)
    const panel = useRef<HTMLDivElement>(null)
    const panelId = useId()
    const placePanel = () => {
        const element = ref.current
        const popup = panel.current
        const trigger = element?.querySelector("summary")
        if (!floating || !element || !popup || !trigger) return
        if (!element.open) {
            popup.hidePopover?.()
            return
        }
        popup.showPopover?.()
        popup.style.maxHeight = "none"
        const anchor = trigger.getBoundingClientRect()
        const bounds = popup.getBoundingClientRect()
        const viewport = window.visualViewport
        const left = viewport?.offsetLeft ?? 0,
            top = viewport?.offsetTop ?? 0
        const right = left + (viewport?.width ?? window.innerWidth)
        const bottom = top + (viewport?.height ?? window.innerHeight)
        const below = Math.max(0, bottom - anchor.bottom - 14)
        const above = Math.max(0, anchor.top - top - 14)
        const upwards = bounds.height > below && above > below
        const height = Math.min(bounds.height, upwards ? above : below)
        popup.style.maxHeight = `${height}px`
        popup.style.left = `${Math.max(left + 8, Math.min(anchor.right - bounds.width, right - bounds.width - 8))}px`
        popup.style.top = `${upwards ? anchor.top - height - 6 : anchor.bottom + 6}px`
    }
    useEffect(() => {
        const closeOutside = (event: Event) => {
            const element = ref.current
            if (element?.open && event.target instanceof window.Node && !element.contains(event.target))
                element.open = false
        }
        const escape = (event: globalThis.KeyboardEvent) => {
            const element = ref.current
            if (event.key !== "Escape" || !element?.open) return
            event.preventDefault()
            event.stopPropagation()
            element.open = false
            element.querySelector("summary")?.focus()
        }
        const closeOnMove = (event: Event) => {
            if (event.target instanceof window.Node && panel.current?.contains(event.target)) return
            if (ref.current?.open) ref.current.open = false
        }
        document.addEventListener("pointerdown", closeOutside, true)
        document.addEventListener("focusin", closeOutside)
        document.addEventListener("keydown", escape)
        if (floating) {
            document.addEventListener("scroll", closeOnMove, true)
            window.addEventListener("resize", closeOnMove)
            window.visualViewport?.addEventListener("resize", closeOnMove)
            window.visualViewport?.addEventListener("scroll", closeOnMove)
        }
        return () => {
            document.removeEventListener("pointerdown", closeOutside, true)
            document.removeEventListener("focusin", closeOutside)
            document.removeEventListener("keydown", escape)
            document.removeEventListener("scroll", closeOnMove, true)
            window.removeEventListener("resize", closeOnMove)
            window.visualViewport?.removeEventListener("resize", closeOnMove)
            window.visualViewport?.removeEventListener("scroll", closeOnMove)
        }
    }, [floating])
    return (
        <details
            ref={ref}
            className={className}
            data-ui-dropdown
            onKeyDown={onKeyDown}
            onToggle={(event) => {
                placePanel()
                if (!event.currentTarget.open) return
                document.querySelectorAll<HTMLDetailsElement>("details[data-ui-dropdown][open]").forEach((element) => {
                    if (element !== event.currentTarget && !element.contains(event.currentTarget)) element.open = false
                })
            }}
            onClick={(event) => {
                const target = event.target as Element
                if (target.closest("button,a") && !target.closest("summary")) event.currentTarget.open = false
            }}
        >
            <summary className={triggerClassName} aria-label={label} aria-controls={panelId} aria-haspopup={popupRole}>
                {trigger}
            </summary>
            <div
                ref={panel}
                id={panelId}
                popover={floating ? "manual" : undefined}
                data-floating-dropdown={floating || undefined}
            >
                {children}
            </div>
        </details>
    )
}
