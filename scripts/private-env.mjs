import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseEnv } from "node:util"

export function runtimeEnvironment() {
    const privatePath =
        process.env.VAULT_ENV_FILE ||
        (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "LATAMWare", "vault", ".env.local") : "")
    if (process.env.VAULT_ENV_FILE && !existsSync(privatePath))
        throw new Error("The configured private environment file was not found.")
    let configured = {}
    for (const file of [".env", ".env.local", privatePath])
        if (file && existsSync(file)) configured = { ...configured, ...parseEnv(readFileSync(file, "utf8")) }
    return { ...configured, ...process.env }
}
