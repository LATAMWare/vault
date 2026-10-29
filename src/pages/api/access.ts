import type { APIRoute } from "astro"

export const GET: APIRoute = ({ locals }) => Response.json({ user: locals.corporateUser }, {
    headers: { "Cache-Control": "no-store" }
})
