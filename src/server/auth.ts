import { Auth, type AuthConfig } from "@auth/core"
import Google from "@auth/core/providers/google"
import { googleIdentity, isAllowedIdentity, parseAccessPolicy, type AccessPolicy } from "./access-policy"

interface GoogleAuthSettings {
    mode: "google"
    origin: string
    secret: string
    clientId: string
    clientSecret: string
    policy: AccessPolicy
}
export type AuthSettings = { mode: "local" } | GoogleAuthSettings

export function readAuthSettings(env: Record<string, string | undefined> = import.meta.env?.DEV ? { ...import.meta.env, ...process.env } : process.env): AuthSettings {
    const mode = env.VAULT_AUTH_MODE ?? (env.NODE_ENV === "production" ? "google" : "local")
    if (mode === "local") return { mode }
    if (mode !== "google") throw new Error("VAULT_AUTH_MODE must be google or local")
    const required = (key: string) => {
        const value = env[key]?.trim()
        if (!value) throw new Error(`Missing ${key}`)
        return value
    }
    const originUrl = new URL(required("VAULT_AUTH_ORIGIN"))
    if (originUrl.username || originUrl.password || originUrl.pathname !== "/" || originUrl.search || originUrl.hash) throw new Error("VAULT_AUTH_ORIGIN must be an origin")
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname)
    if (originUrl.protocol !== "https:" && !(originUrl.protocol === "http:" && localHost)) throw new Error("Authentication requires HTTPS or localhost")
    const secret = required("AUTH_SECRET")
    if (Buffer.byteLength(secret) < 32) throw new Error("AUTH_SECRET must contain at least 32 random bytes")
    return {
        mode, origin: originUrl.origin, secret,
        clientId: required("GOOGLE_AUTH_CLIENT_ID"), clientSecret: required("GOOGLE_AUTH_CLIENT_SECRET"),
        policy: parseAccessPolicy(env.VAULT_ALLOWED_DOMAINS ?? "latamware.com", env.VAULT_ALLOWED_EMAILS ?? "")
    }
}

export function createAuthConfig(settings: GoogleAuthSettings): AuthConfig {
    return {
        basePath: "/api/auth",
        secret: settings.secret,
        trustHost: true, // Requests are canonicalized to the configured origin below.
        useSecureCookies: settings.origin.startsWith("https:"),
        session: { strategy: "jwt", maxAge: 60 * 60 },
        providers: [Google({
            clientId: settings.clientId,
            clientSecret: settings.clientSecret,
            checks: ["pkce", "state", "nonce"],
            authorization: { params: { scope: "openid email profile", prompt: "select_account" } }
        })],
        pages: { signIn: "/login", signOut: "/logout", error: "/login" },
        theme: { colorScheme: "dark", brandColor: "#7c3aed", logo: "/favicon.svg" },
        // Avoid including provider responses, tokens or identity details in logs.
        logger: { error: () => console.error("Vault authentication failed"), warn: () => {}, debug: () => {} },
        callbacks: {
            signIn({ account, profile }) {
                return account?.provider === "google" && isAllowedIdentity(profile, settings.policy)
            },
            jwt({ token, account, profile }) {
                if (account) {
                    if (account.provider !== "google" || !isAllowedIdentity(profile, settings.policy)) return null
                    token.vaultIdentity = googleIdentity(profile)
                    token.vaultAuthenticatedAt = Date.now() / 1000
                }
                // Recheck the policy on every session read, including existing cookies.
                // Never copy the client-supplied `session` update into trusted claims.
                if (!isAllowedIdentity(token.vaultIdentity, settings.policy)) return null
                if (typeof token.vaultAuthenticatedAt !== "number" || Date.now() / 1000 - token.vaultAuthenticatedAt >= 3600 || token.vaultAuthenticatedAt > Date.now() / 1000 + 30) return null
                return token
            },
            session({ session, token }) {
                const identity = googleIdentity(token.vaultIdentity)!
                session.user = { id: identity.sub, email: identity.email, emailVerified: null }
                return { ...session, expires: new Date((Number(token.vaultAuthenticatedAt) + 3600) * 1000).toISOString() }
            },
            redirect({ url }) {
                // Login and logout always return to this deployment. No user-provided redirects.
                return url === "/login" || url === `${settings.origin}/login` ? `${settings.origin}/login` : `${settings.origin}/`
            }
        }
    }
}

export async function handleAuth(request: Request, settings: GoogleAuthSettings): Promise<Response> {
    const source = new URL(request.url)
    const target = new URL(source.pathname + source.search, settings.origin)
    const headers = new Headers(request.headers)
    for (const name of ["host", "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port"]) headers.delete(name)
    if (request.method !== "GET" && request.method !== "HEAD") {
        const origin = headers.get("origin")
        if (origin && origin !== settings.origin) return new Response("Forbidden", { status: 403 })
    }
    const canonical = new Request(target, {
        method: request.method, headers,
        ...(request.method !== "GET" && request.method !== "HEAD" ? { body: await request.arrayBuffer() } : {})
    })
    const authResponse = await Auth(canonical, createAuthConfig(settings))
    // Auth.js redirects can have immutable headers.
    const response = new Response(authResponse.body, { status: authResponse.status, statusText: authResponse.statusText, headers: new Headers(authResponse.headers) })
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    return response
}

export async function readAuthSession(request: Request, settings: GoogleAuthSettings) {
    const response = await handleAuth(new Request(`${settings.origin}/api/auth/session`, {
        headers: { cookie: request.headers.get("cookie") ?? "" }
    }), settings)
    const session = await response.json()
    const user = session?.user
    return {
        user: typeof user?.id === "string" && typeof user.email === "string" ? { id: user.id as string, email: user.email as string } : null,
        authenticatedAt: typeof session?.expires === "string" ? Date.parse(session.expires) - 3600000 : NaN,
        cookies: response.headers.getSetCookie()
    }
}
