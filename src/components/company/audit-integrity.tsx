import { useEffect, useRef, useState } from "react"
import { companyApi, CompanyApiError } from "@logic/company-client"
import { useI18n } from "@logic/i18n"

type Overview = {
    integrity: string
    unsealedCount: number
    batches: { id: string; integrity: string; state: string; blockHash: string | null }[]
}
export default function AuditIntegrity({ vaultId }: { vaultId?: string }) {
    const { t } = useI18n()
    const [data, setData] = useState<Overview | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [verifying, setVerifying] = useState(false),
        [result, setResult] = useState<"pending" | "confirmed" | null>(null)
    const working = useRef(false),
        request = useRef<AbortController | null>(null)
    const path = vaultId ? `/vaults/${encodeURIComponent(vaultId)}/audit/seals` : "/admin/audit/seals"
    const failed = (reason: unknown) => {
        if (reason instanceof CompanyApiError && reason.status === 401) {
            setData(null)
            window.location.replace("/login")
            return
        }
        if (reason instanceof CompanyApiError && [403, 404].includes(reason.status)) setData(null)
        setError(reason instanceof Error ? reason.message : "Could not complete the operation. Please retry.")
    }
    useEffect(() => {
        let active = true
        const load = () => {
            if (working.current || document.visibilityState === "hidden") return
            request.current?.abort()
            const controller = new AbortController()
            request.current = controller
            void companyApi<Overview>(path, "GET", undefined, controller.signal)
                .then((value) => {
                    if (active && !controller.signal.aborted) setData(value)
                })
                .catch((reason) => {
                    if (active && !controller.signal.aborted) failed(reason)
                })
        }
        setData(null)
        setError("")
        setResult(null)
        load()
        const timer = setInterval(load, 30000)
        window.addEventListener("focus", load)
        return () => {
            active = false
            clearInterval(timer)
            request.current?.abort()
            window.removeEventListener("focus", load)
        }
    }, [path])
    const run = async (action: () => Promise<void>, verification = false) => {
        if (working.current) return
        working.current = true
        request.current?.abort()
        setBusy(true)
        setVerifying(verification)
        setError("")
        setResult(null)
        try {
            await action()
        } catch (reason) {
            failed(reason)
        } finally {
            working.current = false
            setBusy(false)
            setVerifying(false)
        }
    }
    const batch = data?.batches[0]
    const changed = data?.integrity === "changed"
    const verify = () =>
        run(async () => {
            if (!batch) return
            const value = await companyApi<Overview>(`${path}/${batch.id}/verify`, "POST")
            setData(value)
            if (value.integrity !== "intact") {
                setError("The sealed activity has changed. Investigate before creating another seal.")
                return
            }
            setResult(
                value.batches.find((entry) => entry.id === batch.id)?.state === "confirmed" ? "confirmed" : "pending"
            )
        }, true)
    const seal = () =>
        run(async () => {
            try {
                setData(await companyApi<Overview>(path, "POST"))
            } catch (reason) {
                setData(await companyApi<Overview>(path))
                throw reason
            }
        })
    const download = () =>
        run(async () => {
            if (!batch) return
            const receipt = await companyApi(`${path}/${batch.id}/download`)
            const url = URL.createObjectURL(new Blob([JSON.stringify(receipt)], { type: "application/json" }))
            const link = document.createElement("a")
            link.href = url
            link.download = `latamware-audit-${batch.id}.json`
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
        })
    const block =
        batch?.state === "confirmed" && batch.blockHash && /^[a-f0-9]{64}$/.test(batch.blockHash)
            ? batch.blockHash
            : null
    return (
        <section className="cw-integrity" aria-label={t("Verifiable activity")} aria-busy={busy}>
            <div className="cw-integrity-heading">
                <h3>
                    <i className="ti ti-shield-check" aria-hidden="true" />
                    {t("Verifiable activity")}
                </h3>
                <span className={changed ? "cw-danger-text" : "cw-role"} role="status">
                    {t(
                        changed
                            ? "Integrity mismatch"
                            : batch?.state === "confirmed"
                              ? "Verified at the last check"
                              : batch?.state === "pending"
                                ? "Awaiting verification"
                                : batch
                                  ? "Ready to submit"
                                  : "No seals yet"
                    )}
                </span>
            </div>
            {error && (
                <p role="alert" className="cw-danger-text">
                    {t(error)}
                </p>
            )}
            <div className="cw-integrity-actions">
                <button
                    className="cw-button"
                    disabled={busy || !batch || batch.state === "unsubmitted" || changed}
                    onClick={() => void verify()}
                >
                    {t(verifying ? "Verifying integrity..." : "Verify integrity")}
                </button>
                <button
                    className="cw-button"
                    disabled={busy || !data || data.unsealedCount === 0 || changed}
                    onClick={() => void seal()}
                >
                    {t("Seal activity")}
                </button>
                <button
                    className="cw-icon-button"
                    aria-label={t("Download verification receipt")}
                    disabled={busy || !batch || batch.state === "unsubmitted" || changed}
                    onClick={() => void download()}
                >
                    <i className="ti ti-download" aria-hidden="true" />
                </button>
                {block && !changed ? (
                    <a
                        className="cw-button"
                        href={`https://mempool.space/block/${block}`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t("Check on Bitcoin")}
                    </a>
                ) : (
                    <button className="cw-button" disabled title={t("Available after confirmation")}>
                        {t("Check on Bitcoin")}
                    </button>
                )}
            </div>
            {result && (
                <p className="cw-integrity-result" role="status">
                    <i className="ti ti-circle-check" aria-hidden="true" />
                    {t(
                        result === "confirmed"
                            ? "Activity integrity verified. The seal is confirmed on Bitcoin."
                            : "Activity integrity verified. Bitcoin confirmation is still pending."
                    )}
                </p>
            )}
        </section>
    )
}
