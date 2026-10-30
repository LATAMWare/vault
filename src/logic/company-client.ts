import type { ItemContent } from "../interfaces/company"

export class CompanyApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message)
    }
}

export async function companyApi<T>(path = "", method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response
    try {
        response = await fetch(`/api/company${path}`, {
            method,
            cache: "no-store",
            signal,
            ...(method !== "GET"
                ? {
                      headers: { "Content-Type": "application/json", "X-Vault-Request": "1" },
                      body: JSON.stringify(body ?? {})
                  }
                : {})
        })
    } catch (error) {
        if (signal?.aborted) throw error
        throw new CompanyApiError(
            0,
            "Connection to Vault was interrupted. Check your connection and retry. The operation may have completed; refresh before trying again."
        )
    }
    const data = await response.json().catch(() => null)
    if (!response.ok)
        throw new CompanyApiError(
            response.status,
            typeof data?.error === "string" ? data.error : "Could not complete the operation. Please retry."
        )
    return data as T
}

export function generateCompanyPassword(length = 24): string {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-=?"
    const limit = 256 - (256 % characters.length)
    let result = ""
    while (result.length < length) {
        for (const value of crypto.getRandomValues(new Uint8Array(64))) {
            if (value < limit) result += characters[value % characters.length]
            if (result.length === length) break
        }
    }
    return result
}

export const emptyCompanyItem = (): ItemContent => ({
    kind: "password",
    title: "",
    username: "",
    password: "",
    url: "",
    notes: ""
})
