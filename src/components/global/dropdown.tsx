import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react"

export default function Dropdown({
    label,
    trigger,
    children,
    className = "",
    triggerClassName = "",
    onKeyDown,
    popupRole
}: {
    label: string
    trigger: ReactNode
    children: ReactNode
    className?: string
    triggerClassName?: string
    onKeyDown?: (event: KeyboardEvent<HTMLDetailsElement>) => void
    popupRole?: "listbox" | "menu"
}) {
    const ref = useRef<HTMLDetailsElement>(null)
    const panelId = useId()
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
        document.addEventListener("pointerdown", closeOutside, true)
        document.addEventListener("focusin", closeOutside)
        document.addEventListener("keydown", escape)
        return () => {
            document.removeEventListener("pointerdown", closeOutside, true)
            document.removeEventListener("focusin", closeOutside)
            document.removeEventListener("keydown", escape)
        }
    }, [])
    return (
        <details
            ref={ref}
            className={className}
            data-ui-dropdown
            onKeyDown={onKeyDown}
            onToggle={(event) => {
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
            <div id={panelId}>{children}</div>
        </details>
    )
}
