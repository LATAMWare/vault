import type { APIRoute } from "astro"
import { handleAuth, readAuthSettings } from "../../../server/auth"

const handler: APIRoute = ({ request }) => {
    const settings = readAuthSettings()
    return settings.mode === "google" ? handleAuth(request, settings) : new Response(null, { status: 404 })
}

export const GET = handler
export const POST = handler
