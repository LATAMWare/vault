import type { APIRoute } from "astro"

// The middleware validates auth configuration before this public readiness check.
export const GET: APIRoute = () => Response.json({ status: "ok" }, {
    headers: { "Cache-Control": "no-store" }
})
