/// <reference types="astro/client" />

declare namespace App {
    interface Locals {
        corporateUser: { id: string; email: string } | null
        companyUser: import("./interfaces/company").CompanyUser | null
    }
}
