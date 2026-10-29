/** Server policy. Only pass claims obtained from a validated Google ID token. */
export interface GoogleIdentity {
    sub: string
    email: string
    email_verified: boolean
    hd?: string
}

export interface AccessPolicy {
    domains: readonly string[]
    emails: readonly string[]
}

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const emailPattern = /^[a-z0-9.!#$%&'+/=?^_`{|}~-]+@([^@\s]+)$/
const normalize = (value: string) => value.trim().toLowerCase()
const entries = (value = "") => [...new Set(value.split(",").map(normalize).filter(Boolean))]

export function parseAccessPolicy(domains: string, emails: string): AccessPolicy {
    const policy = { domains: entries(domains), emails: entries(emails) }
    if (policy.domains.some(domain => !domainPattern.test(domain) || domain.length > 253)) {
        throw new Error("VAULT_ALLOWED_DOMAINS must contain exact domains separated by commas")
    }
    if (policy.emails.some(email => !isEmail(email))) {
        throw new Error("VAULT_ALLOWED_EMAILS must contain exact email addresses separated by commas")
    }
    if (!policy.domains.length && !policy.emails.length) throw new Error("At least one allowed domain or email is required")
    return policy
}

function isEmail(email: string): boolean {
    const match = email.match(emailPattern)
    return Boolean(match && domainPattern.test(match[1]) && email.length <= 254)
}

export function googleIdentity(profile: unknown): GoogleIdentity | null {
    if (!profile || typeof profile !== "object") return null
    const claims = profile as Record<string, unknown>
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || claims.email_verified !== true) return null
    const email = normalize(claims.email)
    if (!isEmail(email)) return null
    if (claims.hd !== undefined && (typeof claims.hd !== "string" || !domainPattern.test(normalize(claims.hd)))) return null
    return { sub: claims.sub, email, email_verified: true, ...(typeof claims.hd === "string" ? { hd: normalize(claims.hd) } : {}) }
}

export function isAllowedIdentity(profile: unknown, policy: AccessPolicy): boolean {
    const identity = googleIdentity(profile)
    if (!identity) return false
    if (policy.emails.includes(identity.email)) return true
    // Email suffix alone is not evidence of Workspace membership. Subdomains are explicit.
    const emailDomain = identity.email.split("@")[1]
    return Boolean(identity.hd && identity.hd === emailDomain && policy.domains.includes(identity.hd))
}
