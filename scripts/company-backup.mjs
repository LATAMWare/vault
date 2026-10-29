import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdirSync, chmodSync } from "node:fs"
import { dirname, isAbsolute } from "node:path"
import { runtimeEnvironment } from "./private-env.mjs"

const source = runtimeEnvironment().VAULT_DATABASE_PATH
const destination = process.argv[2]
if (!source || !isAbsolute(source) || !destination || !isAbsolute(destination) || existsSync(destination)) {
    throw new Error("Configure VAULT_DATABASE_PATH and provide a new absolute backup filename.")
}
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
const database = new DatabaseSync(source, { readOnly: true })
try {
    database.prepare("VACUUM INTO ?").run(destination)
    if (process.platform !== "win32") chmodSync(destination, 0o600)
    console.log("Encrypted database snapshot saved. Encryption keys are not included; preserve them separately.")
} finally {
    database.close()
}
