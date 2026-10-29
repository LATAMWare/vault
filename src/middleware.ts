import { defineMiddleware } from "astro:middleware"
import { readAuthSettings, type AuthSettings } from "./server/auth"
import { readCompanySession } from "./server/company-session"
import { getCompanyStore } from "./server/company-store"

const unavailable = () => new Response("Authentication is not configured. Contact the administrator.", {
    status: 503, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
})

export const onRequest = defineMiddleware(async (context, next) => {
    const path = context.url.pathname
    // Static assets contain no user data and must remain available on the login page.
    if (path.startsWith("/_astro/") || path.startsWith("/libs/") || path.startsWith("/images/") || path.startsWith("/fonts/") || path === "/favicon.svg") return next()
    let settings: AuthSettings
    try { settings = readAuthSettings() } catch { return unavailable() }
    context.locals.corporateUser = null
    context.locals.companyUser = null
    if (settings.mode === "local") return next()
    try { getCompanyStore() } catch { return unavailable() }
    if (path === "/login" || path.startsWith("/api/auth/") || path === "/api/health") return next()
    let authentication: Awaited<ReturnType<typeof readCompanySession>>
    try { authentication = await readCompanySession(context.request, settings) } catch { return unavailable() }
    const { user, cookies } = authentication
    context.locals.corporateUser = user
    context.locals.companyUser = user
    const response = user ? await next() : path.startsWith("/api/")
        ? Response.json({ error: "Unauthorized" }, { status: 401 })
        : context.redirect("/login", 303)
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie)
    response.headers.set("Cache-Control", "no-store")
    return response
})
