import i18next from "i18next"
import { initReactI18next, useTranslation } from "react-i18next"
import spanish from "../locales/es.json"

export type Language = "es" | "en"
export const LANGUAGE_STORAGE_KEY = "vault:language"
export const i18n = i18next.createInstance()

// Start identically on the server and browser to avoid hydration mismatches.
void i18n.use(initReactI18next).init({
    lng: "en", fallbackLng: "en", supportedLngs: ["en", "es"],
    resources: {
        en: { translation: Object.fromEntries(Object.keys(spanish).map(key => [key, key])) },
        es: { translation: spanish }
    },
    keySeparator: false, nsSeparator: false,
    initAsync: false,
    // Output is React text or textContent, never HTML. Disable translation nesting too.
    interpolation: { escapeValue: false, skipOnVariables: true },
    react: { useSuspense: false }
})

export const t = (key: string, values?: Record<string, unknown>): string => String(i18n.t(key, { ...values, returnObjects: false }))

export const detectLanguage = (): Language => {
    if (typeof window === "undefined") return "en"
    try {
        const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
        if (stored === "en" || stored === "es") return stored
    } catch { /* Language selection remains available when storage is disabled. */ }
    return window.navigator.language.toLowerCase().startsWith("es") ? "es" : "en"
}

export const setLanguage = async (language: Language, persist = true) => {
    if (language !== "es" && language !== "en") return
    if (persist && typeof window !== "undefined") {
        try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language) } catch { /* Keep this session's preference. */ }
    }
    await i18n.changeLanguage(language)
    if (typeof document !== "undefined") document.documentElement.lang = language
}

export const useI18n = () => {
    const { i18n: instance } = useTranslation(undefined, { i18n })
    return { language: (instance.resolvedLanguage ?? "en") as Language, t, setLanguage }
}
