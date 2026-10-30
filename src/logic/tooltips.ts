/** Delegated tooltips also work for controls added later in dialogs and menus. */
export function installTooltips() {
    const bubble = document.createElement("div")
    bubble.className = "vault-tooltip"
    bubble.id = "vault-tooltip"
    bubble.setAttribute("role", "tooltip")
    bubble.setAttribute("popover", "manual")
    bubble.hidden = true
    let current: HTMLElement | null = null
    let dismissed: HTMLElement | null = null
    let keyboardMode = false
    let showTimer: ReturnType<typeof setTimeout> | undefined
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const hide = () => {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
        if (current) {
            const descriptions = (current.getAttribute("aria-describedby") ?? "")
                .split(/\s+/)
                .filter((id) => id && id !== bubble.id)
            if (descriptions.length) current.setAttribute("aria-describedby", descriptions.join(" "))
            else current.removeAttribute("aria-describedby")
        }
        current = null
        try {
            bubble.hidePopover()
        } catch {
            /* Older browsers use the positioned fallback. */
        }
        bubble.hidden = true
    }
    const position = () => {
        if (!current?.isConnected) {
            hide()
            return
        }
        const rect = current.getBoundingClientRect()
        const size = bubble.getBoundingClientRect()
        bubble.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - size.width) / 2, window.innerWidth - size.width - 8))}px`
        bubble.style.top = `${Math.max(8, rect.top >= size.height + 12 ? rect.top - size.height - 8 : Math.min(rect.bottom + 8, window.innerHeight - size.height - 8))}px`
    }
    const show = (target: HTMLElement) => {
        if (target === dismissed || (target === current && !bubble.hidden)) return
        hide()
        const nativeTitle = target.getAttribute("title")
        if (nativeTitle) {
            target.dataset.tooltip = nativeTitle
            target.removeAttribute("title")
        }
        const label = target.dataset.tooltip || target.getAttribute("aria-label")
        if (!label) return
        current = target
        bubble.textContent = label
        showTimer = setTimeout(() => {
            if (!target.isConnected || target !== current) return
            ;(target.closest("dialog[open]") ?? document.body).append(bubble)
            bubble.hidden = false
            try {
                bubble.showPopover()
            } catch {
                bubble.removeAttribute("popover")
            }
            const descriptions = (target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
            target.setAttribute("aria-describedby", [...new Set([...descriptions, bubble.id])].join(" "))
            position()
        }, 250)
    }
    const targetFor = (event: Event) =>
        event.target instanceof window.Element
            ? event.target.closest<HTMLElement>("[data-tooltip],[title],button[aria-label],summary[aria-label]")
            : null
    const over = (event: Event) => {
        if (event.target instanceof window.Node && bubble.contains(event.target)) {
            clearTimeout(hideTimer)
            return
        }
        if ((event as PointerEvent).pointerType === "touch") return
        const target = targetFor(event)
        if (target) {
            clearTimeout(hideTimer)
            show(target)
        }
    }
    const out = (event: Event) => {
        const related = (event as PointerEvent).relatedTarget
        if (related instanceof window.Node && (current?.contains(related) || bubble.contains(related))) return
        dismissed = null
        if (keyboardMode && current?.contains(document.activeElement)) return
        clearTimeout(hideTimer)
        hideTimer = setTimeout(hide, 100)
    }
    const focus = (event: Event) => {
        if (!keyboardMode) return
        const target = targetFor(event)
        if (target === dismissed) return
        dismissed = null
        if (target) show(target)
        else hide()
    }
    const blur = () => {
        dismissed = null
        hide()
    }
    const dismiss = (event: Event) => {
        if (event.type === "pointerdown") keyboardMode = false
        if (
            event.type === "keydown" &&
            ((event as KeyboardEvent).key === "Tab" || (event as KeyboardEvent).key.startsWith("Arrow"))
        )
            keyboardMode = true
        if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return
        if (event.target instanceof window.Node && bubble.contains(event.target)) return
        const previous = current
        hide()
        dismissed = previous
    }
    const listeners: [string, EventListener][] = [
        ["pointerover", over],
        ["pointerout", out],
        ["focusin", focus],
        ["focusout", blur],
        ["pointerdown", dismiss],
        ["keydown", dismiss],
        ["cancel", hide],
        ["scroll", hide]
    ]
    for (const [name, handler] of listeners) document.addEventListener(name, handler, true)
    window.addEventListener("resize", hide)
    return () => {
        hide()
        bubble.remove()
        for (const [name, handler] of listeners) document.removeEventListener(name, handler, true)
        window.removeEventListener("resize", hide)
    }
}
