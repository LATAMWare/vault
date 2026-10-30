import type { CompanyUser, CompanyVault } from "../../interfaces/company"
import { useCompany } from "./controller"
import CompanyWorkspace from "./workspace"

export default function Company({ user, initialVaults }: { user: CompanyUser; initialVaults?: CompanyVault[] }) {
    const controller = useCompany(user, initialVaults)
    return <CompanyWorkspace controller={controller} />
}
