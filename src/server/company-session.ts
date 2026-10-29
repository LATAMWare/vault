import { readAuthSession, type AuthSettings } from "./auth"
import { CompanyError, getCompanyStore } from "./company-store"
import type { CompanyUser } from "../interfaces/company"

export async function readCompanySession(request: Request, settings: Exclude<AuthSettings, { mode: "local" }>) {
    const session = await readAuthSession(request, settings)
    let user: CompanyUser | null = null
    let denied = false
    if (session.user) {
        try {
            user = getCompanyStore().authenticate(session.user, session.authenticatedAt)
        } catch (error) {
            if (!(error instanceof CompanyError) || ![401, 403].includes(error.status)) throw error
            denied = error.status === 403
        }
    }
    return { user, cookies: session.cookies, denied }
}
