import { generateId } from "@logic/utils"

const getAlertContainer = () => {
    let container = window.document.querySelector('.alerts-container')
    if (!container) {
        container = document.createElement('div')
        container.classList.add('alerts-container')
        window.document.body.append(container)
    }
    return container
}

const closeAlert = (alertElement: HTMLElement) => {
    alertElement.classList.remove('show')
    alertElement.classList.add('disapear')
    setTimeout(() => { alertElement.remove() }, 500)
}

export const showAlert = (message: string, type: string, icon: string, time: number) => {

    const id = generateId()
    const container = getAlertContainer()

    const alert = document.createElement('div')

    alert.classList.add('alert')
    alert.classList.add(type)

    alert.setAttribute("id", id)

    const iconContainer = document.createElement('span')
    const iconElement = document.createElement('i')
    iconElement.className = `icon ti ti-${/^[a-z0-9-]+$/i.test(icon) ? icon : "info-circle"}`
    iconContainer.append(iconElement)
    const text = document.createElement('span')
    text.textContent = message.replace(/<\/?b>/g, "")
    const closeButton = document.createElement('button')
    closeButton.className = 'alert-close'
    closeButton.setAttribute('aria-label', 'Cerrar alerta')
    closeButton.textContent = '×'
    alert.append(iconContainer, text, closeButton)

    container.append(alert)
    
    if (closeButton) {
        closeButton.addEventListener('click', () => closeAlert(alert))
    }
    
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let startTime = Date.now()
    
    const startTimeout = () => {
        const elapsedTime = Date.now() - startTime
        const remainingTime = Math.max(0, time - elapsedTime)
        
        timeoutId = setTimeout(() => {
            const bodyAlert = window.document.getElementById(id)
            if(!bodyAlert) return
            closeAlert(bodyAlert)
        }, remainingTime)
    }
    
    alert.addEventListener('mouseenter', () => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId)
            timeoutId = null
        }
    })
    
    alert.addEventListener('mouseleave', () => {
        startTimeout()
    })
    
    requestAnimationFrame(() => alert.classList.add('show'))
    startTimeout()

}
