export type LoginError = "access-denied" | "expired-attempt" | "configuration" | "google" | "connection"

// Interpret only known Auth.js error codes, never render query-string text.
export function getLoginError(code: string | null): LoginError | null {
    switch (code) {
        case "AccessDenied": return "access-denied"
        case "MissingCSRF":
        case "Verification": return "expired-attempt"
        case "Configuration": return "configuration"
        case "OAuthCallbackError":
        case "OAuthAccountNotLinked":
        case "AccountNotLinked": return "google"
        default: return null
    }
}
