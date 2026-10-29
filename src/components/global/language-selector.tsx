import type { KeyboardEvent, MouseEvent } from "react"
import { useI18n, type Language } from "@logic/i18n"
import Dropdown from "./dropdown"

function Flag({ language }: { language: Language }) {
    return language === "es" ? (
        <svg aria-hidden="true" viewBox="0 0 30 20" className="language-flag">
            <path fill="#74acdf" d="M0 0h30v20H0z" />
            <path fill="#fff" d="M0 6.67h30v6.66H0z" />
            <circle fill="#f6b40e" cx="15" cy="10" r="2" />
            <path
                stroke="#f6b40e"
                strokeWidth=".7"
                d="M15 6.8v6.4m-3.2-3.2h6.4m-5.46-2.26 4.52 4.52m0-4.52-4.52 4.52"
            />
        </svg>
    ) : (
        <svg aria-hidden="true" viewBox="0 0 30 20" className="language-flag">
            <path fill="#fff" d="M0 0h30v20H0z" />
            {[0, 3.08, 6.16, 9.24, 12.32, 15.4, 18.48].map((y) => (
                <path key={y} fill="#b22234" d={`M0 ${y}h30v1.54H0z`} />
            ))}
            <path fill="#3c3b6e" d="M0 0h13v10.77H0z" />
            {[2, 5, 8].flatMap((y) =>
                [2, 5, 8, 11].map((x) => <circle key={`${x}-${y}`} fill="#fff" cx={x} cy={y} r=".55" />)
            )}
        </svg>
    )
}

export default function LanguageSelector() {
    const { language, setLanguage, t } = useI18n()
    const names = { es: "Español", en: "English" }
    const choose = (value: Language, event: MouseEvent<HTMLButtonElement>) => {
        void setLanguage(value)
        const element = event.currentTarget.closest("details")!
        element.open = false
        element.querySelector("summary")?.focus()
    }
    const keyboard = (event: KeyboardEvent<HTMLDetailsElement>) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const element = event.currentTarget
        element.open = true
        const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>("[data-language-option]"))
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : current < 0
                    ? buttons.findIndex((button) => button.getAttribute("aria-pressed") === "true")
                    : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        buttons[Math.max(0, next)]?.focus()
    }
    return (
        <div className="language-selector" role="group" aria-label={t("Language")}>
            <Dropdown
                className="language-dropdown"
                triggerClassName="language-trigger"
                label={`${t("Select language")}: ${names[language]}`}
                onKeyDown={keyboard}
                trigger={
                    <>
                        <Flag language={language} />
                        <svg className="language-chevron" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m4 6 4 4 4-4"
                            />
                        </svg>
                    </>
                }
            >
                <div className="language-popover">
                    {(["es", "en"] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            data-language-option
                            aria-label={names[value]}
                            className="language-option"
                            aria-pressed={language === value}
                            onClick={(event) => choose(value, event)}
                        >
                            <Flag language={value} />
                            <span>{names[value]}</span>
                            {language === value && (
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <path
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="m3 8 3 3 7-7"
                                    />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>
            </Dropdown>
        </div>
    )
}
