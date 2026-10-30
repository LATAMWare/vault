import { useEffect, useState } from "react"
import { useI18n } from "@logic/i18n"
import { setupPwa, getInstallPrompt, clearInstallPrompt } from "@logic/pwa"
import CompanyDialog from "../company/dialog"

export default function InstallApp() {
    const { t } = useI18n()
    const [installed, setInstalled] = useState(false),
        [help, setHelp] = useState(false)
    useEffect(() => {
        setupPwa()
        const update = () =>
            setInstalled(
                Boolean(
                    window.matchMedia?.("(display-mode: standalone)").matches ||
                    (navigator as Navigator & { standalone?: boolean }).standalone
                )
            )
        update()
        window.addEventListener("vault:installed", update)
        return () => window.removeEventListener("vault:installed", update)
    }, [])
    const install = async () => {
        const event = getInstallPrompt()
        if (!event) {
            setHelp(true)
            return
        }
        clearInstallPrompt()
        try {
            if ((await event.prompt()).outcome === "accepted") setInstalled(true)
        } catch {
            setHelp(true)
        }
    }
    if (installed) return null
    return (
        <>
            <button className="cw-nav-button" onClick={() => void install()}>
                <i className="ti ti-device-mobile" aria-hidden="true" />
                <span>{t("Install app")}</span>
            </button>
            {help && (
                <CompanyDialog title={t("Install LATAMWare Vault")} onClose={() => setHelp(false)}>
                    <div className="cw-dialog-body">
                        <p className="cw-dialog-description">
                            {t(
                                "Open this site in your device browser to install it. The installation option depends on your browser."
                            )}
                        </p>
                        <ol className="cw-transfer-guide">
                            <li>{t("Chrome or Edge: open the browser menu and choose Install app.")}</li>
                            <li>{t("iPhone or iPad: open Safari, tap Share and choose Add to Home Screen.")}</li>
                        </ol>
                        <p className="cw-dialog-description">
                            {t(
                                "An internet connection is required to access vaults and check permissions. Passwords are not saved for offline access."
                            )}
                        </p>
                        <button className="cw-button" onClick={() => setHelp(false)}>
                            {t("Close")}
                        </button>
                    </div>
                </CompanyDialog>
            )}
        </>
    )
}
