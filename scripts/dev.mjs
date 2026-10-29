import { spawn } from "node:child_process"
import { runtimeEnvironment } from "./private-env.mjs"

const child = spawn(process.execPath, ["node_modules/astro/bin/astro.mjs", "dev", ...process.argv.slice(2)], {
    env: runtimeEnvironment(),
    stdio: "inherit",
    windowsHide: true
})
child.on("error", () => {
    console.error("Could not start the development server.")
    process.exitCode = 1
})
child.on("exit", (code) => {
    process.exitCode = code ?? 1
})
for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
        if (child.exitCode === null) child.kill(signal)
    })
