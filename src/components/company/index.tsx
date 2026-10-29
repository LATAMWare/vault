import type { CompanyUser } from "../../interfaces/company"
import { useCompany } from "./controller"
import CompanyWorkspace from "./workspace"

export default function Company({ user }: { user: CompanyUser }) {
    const controller = useCompany(user)
    return <CompanyWorkspace controller={controller} />
}
