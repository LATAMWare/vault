import { lazy, Suspense, useEffect, useRef } from "react"
import Dropdown from "@component/global/dropdown"
import LanguageSelector from "@component/global/language-selector"
import InstallApp from "@component/global/install-app"
import { companyApi } from "@logic/company-client"
import type { CompanyMember } from "../../interfaces/company"
import type { AdminData, CompanyController } from "./controller"
import CompanyDialog from "./dialog"
import CompanyItemForm from "./item-form"
import AuditIntegrity from "./audit-integrity"
import ActivityFeed from "./activity-feed"
const CompanyMigration = lazy(() => import("./migration"))

const roleNames = {
    owner: "Owner",
    admin: "Manage access",
    editor: "Edit",
    reader: "Read only"
} as const
const Icon = ({ name }: { name: string }) => <i className={`ti ti-${name}`} aria-hidden="true" />

export default function CompanyWorkspace({ controller: c }: { controller: CompanyController }) {
    const { t } = c
    const search = useRef<HTMLInputElement>(null)
    const invoker = useRef<HTMLElement | null>(null)
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "k" &&
                !document.querySelector("dialog[open]")
            ) {
                event.preventDefault()
                search.current?.focus()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])
    const filteredVaults = c.vaults.filter((vault) =>
        vault.name.toLocaleLowerCase().includes(c.query.toLocaleLowerCase())
    )
    const filteredItems =
        c.vault?.items
            .filter((item) =>
                [item.title, item.username, item.url].some((value) =>
                    value.toLocaleLowerCase().includes(c.query.toLocaleLowerCase())
                )
            )
            .toSorted((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned))) ?? []
    const sidebar = (
        <aside className="cw-sidebar">
            <div className="cw-brand">
                <span className="cw-brand-mark">
                    <Icon name="vault" />
                </span>
                <div>
                    <strong>VAULT</strong>
                    <small>LATAMWARE</small>
                </div>
            </div>
            <nav className="cw-nav" aria-label={t("Workspace navigation")}>
                <button
                    className="cw-nav-button"
                    aria-current={!c.activeId && !c.adminOpen ? "page" : undefined}
                    onClick={() => c.selectVault("")}
                >
                    <Icon name="layout-grid" />
                    <span>{t("All vaults")}</span>
                </button>
                <div className="cw-nav-heading">
                    <span>{t("Your vaults")}</span>
                    <span>{c.vaults.length}</span>
                </div>
                <div className="cw-nav-list">
                    {c.vaults.map((vault) => (
                        <button
                            key={vault.id}
                            className="cw-nav-button"
                            aria-current={c.activeId === vault.id && !c.adminOpen ? "page" : undefined}
                            onClick={() => c.selectVault(vault.id)}
                        >
                            <Icon name="vault" />
                            <span>{vault.name}</span>
                            <span className="cw-nav-count">{vault.itemCount}</span>
                        </button>
                    ))}
                </div>
                <button className="cw-nav-button" onClick={c.openNewVault}>
                    <Icon name="plus" />
                    <span>{t("Create New Vault")}</span>
                </button>
            </nav>
            <div className="cw-sidebar-bottom">
                {c.me.isAdmin && (
                    <button
                        className="cw-nav-button"
                        aria-current={c.adminOpen ? "page" : undefined}
                        onClick={c.openAdmin}
                    >
                        <Icon name="shield-cog" />
                        <span>{t("Administration")}</span>
                    </button>
                )}
                <button
                    className="cw-nav-button"
                    onClick={() => {
                        c.setImporting(true)
                        c.setMobileNav(false)
                    }}
                >
                    <Icon name="archive" />
                    <span>{t("Import and export")}</span>
                </button>
                <InstallApp />
                <div className="cw-language">
                    <span className="cw-language-label">
                        <Icon name="world" />
                        {t("Language")}
                    </span>
                    <LanguageSelector />
                </div>
                <div className="cw-person">
                    <span className="cw-avatar" aria-hidden="true">
                        {c.me.email.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="cw-person-info">
                        <strong title={c.me.email}>{c.me.email}</strong>
                        <small>
                            <Icon name="circle-check" />
                            {t("Google session")}
                        </small>
                    </div>
                    <Dropdown
                        className="cw-menu"
                        triggerClassName="cw-icon-button"
                        label={t("Account options")}
                        trigger={<Icon name="dots-vertical" />}
                    >
                        <div className="cw-menu-popover">
                            <button
                                type="button"
                                onClick={() =>
                                    c.setConfirmation({
                                        title: t("Close all my sessions"),
                                        description: t("Close your sessions on every device?"),
                                        label: t("Close sessions"),
                                        action: async () => {
                                            await companyApi("/me/revoke-sessions", "POST")
                                            window.location.replace("/login")
                                        }
                                    })
                                }
                            >
                                <Icon name="devices" />
                                {t("Close sessions")}
                            </button>
                            <a className="cw-nav-button" href="/logout">
                                <Icon name="logout" />
                                {t("Sign out")}
                            </a>
                        </div>
                    </Dropdown>
                </div>
            </div>
        </aside>
    )

    return (
        <div
            className="cw-shell"
            onClickCapture={(event) => {
                const target = (event.target as Element).closest<HTMLElement>("button,summary,a")
                if (target) invoker.current = target.closest("details")?.querySelector("summary") ?? target
            }}
        >
            <a className="cw-skip" href="#company-content">
                {t("Skip to content")}
            </a>
            <div className="cw-desktop-sidebar">{sidebar}</div>
            <div className="cw-workspace">
                <header className="cw-topbar">
                    <button
                        className="cw-icon-button cw-mobile-toggle"
                        data-company-mobile-menu
                        aria-label={t("Open menu")}
                        aria-expanded={c.mobileNav}
                        aria-controls="company-mobile-navigation"
                        onClick={() => c.setMobileNav(true)}
                    >
                        <Icon name="menu-2" />
                    </button>
                    <div className="cw-breadcrumb">
                        <span className="cw-breadcrumb-parent">LATAMWare</span>
                        <Icon name="chevron-right" />
                        <span>{c.adminOpen ? t("Administration") : (c.vault?.name ?? t("All vaults"))}</span>
                    </div>
                    {!c.adminOpen && (
                        <label className="cw-search">
                            <Icon name="search" />
                            <span className="sr-only">{c.activeId ? t("Search this vault") : t("Search vaults")}</span>
                            <input
                                ref={search}
                                type="search"
                                value={c.query}
                                onChange={(event) => c.setQuery(event.target.value)}
                                placeholder={c.activeId ? t("Search this vault") : t("Search vaults")}
                                aria-keyshortcuts="Control+k Meta+k"
                            />
                            <kbd aria-hidden="true">Ctrl K</kbd>
                        </label>
                    )}
                </header>
                <main id="company-content" className="cw-main" tabIndex={-1} aria-busy={c.loading}>
                    {c.error && (
                        <div role="alert" className="cw-alert">
                            <Icon name="alert-circle" />
                            <span>{t(c.error)}</span>
                            <button
                                className="cw-button cw-button-quiet"
                                onClick={() => {
                                    c.setError("")
                                    void c.refresh().catch((reason) => c.setError(reason.message))
                                }}
                            >
                                {t("Refresh")}
                            </button>
                            <button className="cw-icon-button" aria-label={t("Close")} onClick={() => c.setError("")}>
                                <Icon name="x" />
                            </button>
                        </div>
                    )}
                    {c.adminOpen ? (
                        <>
                            <div className="cw-page-heading">
                                <div>
                                    <p className="cw-eyebrow">{t("Workspace")}</p>
                                    <h1>{t("Administration")}</h1>
                                    <p>{t("Manage the team's access and review important activity.")}</p>
                                </div>
                            </div>
                            <section className="cw-admin-section">
                                <h2>{t("Users")}</h2>
                                <div className="cw-table-wrap">
                                    <table className="cw-table">
                                        <caption className="sr-only">{t("Users")}</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">{t("Email")}</th>
                                                <th scope="col">{t("Status")}</th>
                                                <th scope="col">
                                                    <span className="sr-only">{t("Actions")}</span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {c.adminData?.users.map((user) => (
                                                <tr key={user.id}>
                                                    <td>{user.email}</td>
                                                    <td>
                                                        <span
                                                            className={`cw-enabled ${user.disabled ? "cw-disabled" : ""}`}
                                                        >
                                                            {user.disabled ? t("Disabled") : t("Enabled")}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {user.id !== c.me.id && (
                                                            <div className="cw-table-actions">
                                                                <button
                                                                    className="cw-button cw-button-quiet"
                                                                    disabled={c.busy}
                                                                    onClick={() =>
                                                                        c.setConfirmation({
                                                                            title: t("Close sessions"),
                                                                            description: t(
                                                                                "Close sessions for {{email}}?",
                                                                                { email: user.email }
                                                                            ),
                                                                            label: t("Close sessions"),
                                                                            action: async () => {
                                                                                await companyApi(
                                                                                    `/admin/users/${encodeURIComponent(user.id)}/revoke`,
                                                                                    "POST"
                                                                                )
                                                                                c.setAdminData(
                                                                                    await companyApi<AdminData>(
                                                                                        "/admin"
                                                                                    )
                                                                                )
                                                                            }
                                                                        })
                                                                    }
                                                                >
                                                                    {t("Close sessions")}
                                                                </button>
                                                                <button
                                                                    className="cw-button"
                                                                    disabled={c.busy}
                                                                    onClick={() =>
                                                                        c.setConfirmation({
                                                                            title: user.disabled
                                                                                ? t("Enable")
                                                                                : t("Disable"),
                                                                            description: t(
                                                                                "Change access for {{email}}?",
                                                                                { email: user.email }
                                                                            ),
                                                                            label: user.disabled
                                                                                ? t("Enable")
                                                                                : t("Disable"),
                                                                            danger: !user.disabled,
                                                                            action: async () => {
                                                                                await companyApi(
                                                                                    `/admin/users/${encodeURIComponent(user.id)}/status`,
                                                                                    "POST",
                                                                                    {
                                                                                        disabled: !user.disabled
                                                                                    }
                                                                                )
                                                                                c.setAdminData(
                                                                                    await companyApi<AdminData>(
                                                                                        "/admin"
                                                                                    )
                                                                                )
                                                                            }
                                                                        })
                                                                    }
                                                                >
                                                                    {user.disabled ? t("Enable") : t("Disable")}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                            <section className="cw-admin-section">
                                <h2>{t("Vault recovery")}</h2>
                                <p className="cw-dialog-description">
                                    {t(
                                        "System access does not grant access to every vault. Administrator recovery is recorded in the audit log."
                                    )}
                                </p>
                                {c.adminData?.vaults.map((vault) => (
                                    <div className="cw-recovery-row" key={vault.id}>
                                        <div>
                                            <strong>{vault.name}</strong>
                                            <small>{vault.owner}</small>
                                        </div>
                                        <button
                                            className="cw-button"
                                            disabled={c.busy}
                                            onClick={() =>
                                                c.setConfirmation({
                                                    title: t("Recover access"),
                                                    description: t(
                                                        "Recover administrator access to this vault? This action is audited."
                                                    ),
                                                    label: t("Recover access"),
                                                    action: async () => {
                                                        await companyApi(`/admin/vaults/${vault.id}/recover`, "POST")
                                                        await c.refresh()
                                                        c.selectVault(vault.id)
                                                    }
                                                })
                                            }
                                        >
                                            <Icon name="key" />
                                            {t("Recover access")}
                                        </button>
                                    </div>
                                ))}
                            </section>
                            <section className="cw-admin-section">
                                <h2>{t("Activity")}</h2>
                                <AuditIntegrity />
                                <ActivityFeed />
                            </section>
                        </>
                    ) : !c.activeId ? (
                        <>
                            <div className="cw-page-heading">
                                <div>
                                    <p className="cw-eyebrow">{t("Workspace")}</p>
                                    <h1>{t("Your vaults")}</h1>
                                    <p>
                                        {t(
                                            "Organize passwords and share them with your team. Everything starts with a vault."
                                        )}
                                    </p>
                                </div>
                                <button className="cw-button cw-button-primary" onClick={c.openNewVault}>
                                    <Icon name="plus" />
                                    {t("Create New Vault")}
                                </button>
                            </div>
                            <div className="cw-stats">
                                <div className="cw-stat">
                                    <Icon name="vault" />
                                    <div>
                                        <strong>{c.vaults.length}</strong>
                                        <span>{t(c.vaults.length === 1 ? "Vault" : "Vaults")}</span>
                                    </div>
                                </div>
                                <div className="cw-stat">
                                    <Icon name="key" />
                                    <div>
                                        <strong>{c.vaults.reduce((sum, vault) => sum + vault.itemCount, 0)}</strong>
                                        <span>{t("Items")}</span>
                                    </div>
                                </div>
                                <span className="cw-stat-note">
                                    <Icon name="shield-check" />
                                    {t("Google connected")}
                                </span>
                            </div>
                            {c.loading ? (
                                <div className="cw-loading" role="status">
                                    <Icon name="loader-2 cw-spin" /> {t("Loading vaults…")}
                                </div>
                            ) : !c.vaults.length ? (
                                <div className="cw-empty">
                                    <span className="cw-empty-icon">
                                        <Icon name="vault" />
                                    </span>
                                    <h2>{t("A place for your team's passwords")}</h2>
                                    <p>{t("Your own vaults and the ones shared with you will appear here.")}</p>
                                    <button className="cw-button cw-button-primary" onClick={c.openNewVault}>
                                        <Icon name="plus" />
                                        {t("Create New Vault")}
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="cw-section-title">
                                        <h2>{t("All vaults")}</h2>
                                        <span>{t("Only you and authorized members")}</span>
                                    </div>
                                    {filteredVaults.length ? (
                                        <div className="cw-vault-grid">
                                            {filteredVaults.map((vault) => (
                                                <button
                                                    className="cw-vault-card"
                                                    key={vault.id}
                                                    onClick={() => c.selectVault(vault.id)}
                                                >
                                                    <span className="cw-vault-card-top">
                                                        <span className="cw-vault-symbol">
                                                            <Icon name="vault" />
                                                        </span>
                                                        <span className="cw-vault-card-arrow">
                                                            <Icon name="arrow-up-right" />
                                                        </span>
                                                    </span>
                                                    <h3>{vault.name}</h3>
                                                    <span className="cw-card-meta">
                                                        <span>
                                                            {vault.itemCount}{" "}
                                                            {t(vault.itemCount === 1 ? "Item" : "Items")}
                                                        </span>
                                                        <span className="cw-role">
                                                            <Icon name={vault.role === "owner" ? "crown" : "users"} />
                                                            {t(roleNames[vault.role])}
                                                        </span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="cw-dialog-description">{t("No results. Try another search.")}</p>
                                    )}
                                </>
                            )}
                        </>
                    ) : c.vault ? (
                        <>
                            <div className="cw-page-heading">
                                <div>
                                    <p className="cw-eyebrow">{t("Vault")}</p>
                                    <h1>{c.vault.name}</h1>
                                    <div className="cw-vault-subline">
                                        <span className="cw-role">
                                            <Icon name={c.vault.role === "owner" ? "crown" : "users"} />
                                            {t(roleNames[c.vault.role])}
                                        </span>
                                        <span>
                                            {c.vault.items.length} {t(c.vault.items.length === 1 ? "Item" : "Items")}
                                        </span>
                                    </div>
                                </div>
                                <div className="cw-heading-actions">
                                    {c.canManage && (
                                        <button
                                            className="cw-button"
                                            disabled={c.busy}
                                            onClick={() => void c.perform(c.loadMembers)}
                                        >
                                            <Icon name="users-plus" />
                                            {t("Share")}
                                        </button>
                                    )}
                                    {c.canEdit && (
                                        <button
                                            className="cw-button cw-button-primary"
                                            disabled={c.busy}
                                            onClick={c.startItem}
                                        >
                                            <Icon name="plus" />
                                            {t("Add password or note")}
                                        </button>
                                    )}
                                    {c.canManage && (
                                        <Dropdown
                                            className="cw-menu"
                                            triggerClassName="cw-icon-button"
                                            label={t("Vault options")}
                                            trigger={<Icon name="dots" />}
                                        >
                                            <div className="cw-menu-popover">
                                                <button
                                                    onClick={(event) => {
                                                        event.currentTarget.closest("details")?.removeAttribute("open")
                                                        c.setVaultName(c.vault!.name)
                                                        c.setRenaming(true)
                                                    }}
                                                >
                                                    <Icon name="pencil" />
                                                    {t("Rename")}
                                                </button>
                                                <button
                                                    onClick={(event) => {
                                                        event.currentTarget.closest("details")?.removeAttribute("open")
                                                        void c.perform(async () => c.setAudit([]))
                                                    }}
                                                >
                                                    <Icon name="history" />
                                                    {t("Activity")}
                                                </button>
                                                {c.vault.role === "owner" && (
                                                    <button
                                                        className="cw-danger-text"
                                                        onClick={(event) => {
                                                            event.currentTarget
                                                                .closest("details")
                                                                ?.removeAttribute("open")
                                                            c.setConfirmation({
                                                                title: t("Delete vault"),
                                                                description: t(
                                                                    "Permanently delete this vault and its contents?"
                                                                ),
                                                                label: t("Delete"),
                                                                danger: true,
                                                                action: async () => {
                                                                    await companyApi(
                                                                        `/vaults/${c.activeId}`,
                                                                        "DELETE",
                                                                        { version: c.vault!.version }
                                                                    )
                                                                    c.selectVault("")
                                                                    await c.refreshIndex()
                                                                }
                                                            })
                                                        }}
                                                    >
                                                        <Icon name="trash" />
                                                        {t("Delete vault")}
                                                    </button>
                                                )}
                                            </div>
                                        </Dropdown>
                                    )}
                                </div>
                            </div>
                            {!c.vault.items.length ? (
                                <div className="cw-empty">
                                    <span className="cw-empty-icon">
                                        <Icon name="key" />
                                    </span>
                                    <h2>{t("Your vault is ready")}</h2>
                                    <p>{t("Keep passwords, login details and secure notes together.")}</p>
                                    {c.canEdit && (
                                        <button className="cw-button cw-button-primary" onClick={c.startItem}>
                                            <Icon name="plus" />
                                            {t("Add password or note")}
                                        </button>
                                    )}
                                </div>
                            ) : filteredItems.length ? (
                                <>
                                    <div className="cw-list-labels" aria-hidden="true">
                                        <span>{t("Name")}</span>
                                        <span>{t("Actions")}</span>
                                    </div>
                                    <ul className="cw-item-list">
                                        {filteredItems.map((item) => (
                                            <li key={item.id}>
                                                <article aria-label={item.title}>
                                                    <div className="cw-item-row">
                                                        <span
                                                            className={`cw-item-symbol ${item.kind === "note" ? "cw-item-symbol-note" : ""}`}
                                                        >
                                                            <Icon name={item.kind === "note" ? "file-text" : "key"} />
                                                        </span>
                                                        <div className="cw-item-description">
                                                            <h3>
                                                                {item.title}
                                                                {item.pinned && (
                                                                    <span className="cw-pinned-label">
                                                                        <Icon name="pinned" />
                                                                        {t("Pinned")}
                                                                    </span>
                                                                )}
                                                            </h3>
                                                            <p>
                                                                {item.username ||
                                                                    (item.kind === "note"
                                                                        ? t("Secure note")
                                                                        : item.url || t("Password"))}
                                                            </p>
                                                        </div>
                                                        <span
                                                            className={`cw-item-value ${c.revealed.includes(item.id) ? "cw-item-value-revealed" : ""}`}
                                                        >
                                                            {item.kind === "password" && c.revealed.includes(item.id)
                                                                ? item.password
                                                                : "••••••••••••"}
                                                        </span>
                                                        <div className="cw-item-actions">
                                                            <button
                                                                className="cw-icon-button cw-pin-button"
                                                                aria-label={t(
                                                                    item.pinned ? "Unpin {{name}}" : "Pin {{name}}",
                                                                    { name: item.title }
                                                                )}
                                                                title={t(item.pinned ? "Unpin" : "Pin")}
                                                                aria-pressed={Boolean(item.pinned)}
                                                                disabled={c.busy}
                                                                onClick={() => void c.pinItem(item)}
                                                            >
                                                                <Icon name={item.pinned ? "pinned" : "pin"} />
                                                            </button>
                                                            <button
                                                                className="cw-icon-button"
                                                                aria-label={
                                                                    c.revealed.includes(item.id)
                                                                        ? t("Hide {{name}}", {
                                                                              name: item.title
                                                                          })
                                                                        : t("Show {{name}}", {
                                                                              name: item.title
                                                                          })
                                                                }
                                                                title={
                                                                    c.revealed.includes(item.id) ? t("Hide") : t("Show")
                                                                }
                                                                aria-pressed={c.revealed.includes(item.id)}
                                                                onClick={() =>
                                                                    c.setRevealed((ids) =>
                                                                        ids.includes(item.id)
                                                                            ? ids.filter((id) => id !== item.id)
                                                                            : [...ids, item.id]
                                                                    )
                                                                }
                                                            >
                                                                <Icon
                                                                    name={
                                                                        c.revealed.includes(item.id) ? "eye-off" : "eye"
                                                                    }
                                                                />
                                                            </button>
                                                            <button
                                                                className="cw-icon-button"
                                                                aria-label={t("Copy {{name}}", {
                                                                    name: item.title
                                                                })}
                                                                title={t(
                                                                    item.kind === "password"
                                                                        ? "Copy password"
                                                                        : "Copy note"
                                                                )}
                                                                onClick={() => {
                                                                    void c.copyItem(
                                                                        item,
                                                                        item.kind === "password" ? "password" : "notes"
                                                                    )
                                                                }}
                                                            >
                                                                <Icon name="copy" />
                                                            </button>
                                                            {item.kind === "password" && item.username && (
                                                                <button
                                                                    className="cw-icon-button"
                                                                    aria-label={t("Copy username for {{name}}", {
                                                                        name: item.title
                                                                    })}
                                                                    title={t("Copy username")}
                                                                    onClick={() => void c.copyItem(item, "username")}
                                                                >
                                                                    <Icon name="user" />
                                                                </button>
                                                            )}
                                                            {c.canEdit && (
                                                                <Dropdown
                                                                    className="cw-menu"
                                                                    triggerClassName="cw-icon-button"
                                                                    label={t("Options for {{name}}", {
                                                                        name: item.title
                                                                    })}
                                                                    trigger={<Icon name="dots-vertical" />}
                                                                >
                                                                    <div className="cw-menu-popover">
                                                                        <button
                                                                            onClick={(event) => {
                                                                                event.currentTarget
                                                                                    .closest("details")
                                                                                    ?.removeAttribute("open")
                                                                                c.setEditing({
                                                                                    id: item.id,
                                                                                    version: item.version,
                                                                                    content: item
                                                                                })
                                                                            }}
                                                                        >
                                                                            <Icon name="pencil" />
                                                                            {t("Edit")}
                                                                        </button>
                                                                        <button
                                                                            className="cw-danger-text"
                                                                            onClick={(event) => {
                                                                                event.currentTarget
                                                                                    .closest("details")
                                                                                    ?.removeAttribute("open")
                                                                                c.setConfirmation({
                                                                                    title: t("Delete item"),
                                                                                    description: t(
                                                                                        "Permanently delete this item?"
                                                                                    ),
                                                                                    label: t("Delete"),
                                                                                    danger: true,
                                                                                    action: async () => {
                                                                                        await companyApi(
                                                                                            `/vaults/${c.activeId}/items/${item.id}`,
                                                                                            "DELETE",
                                                                                            {
                                                                                                version: item.version
                                                                                            }
                                                                                        )
                                                                                        await c.refresh()
                                                                                    }
                                                                                })
                                                                            }}
                                                                        >
                                                                            <Icon name="trash" />
                                                                            {t("Delete")}
                                                                        </button>
                                                                    </div>
                                                                </Dropdown>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {c.revealed.includes(item.id) && (item.notes || item.url) && (
                                                        <div className="cw-item-expanded">
                                                            {item.url &&
                                                                (/^https?:\/\//i.test(item.url) ? (
                                                                    <a
                                                                        href={item.url}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                    >
                                                                        {item.url}
                                                                    </a>
                                                                ) : (
                                                                    <span>{item.url}</span>
                                                                ))}
                                                            {item.notes && <pre>{item.notes}</pre>}
                                                        </div>
                                                    )}
                                                </article>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : (
                                <p className="cw-dialog-description">{t("No results. Try another search.")}</p>
                            )}
                        </>
                    ) : (
                        <div className="cw-loading" role="status">
                            {t("Loading vaults…")}
                        </div>
                    )}
                </main>
            </div>
            {c.notice && (
                <div role="status" className="cw-toast">
                    <Icon name="circle-check" />
                    <span>{c.notice}</span>
                    <button className="cw-icon-button" aria-label={t("Close")} onClick={() => c.setNotice("")}>
                        <Icon name="x" />
                    </button>
                </div>
            )}
            <CompanyDialog
                open={c.mobileNav}
                returnFocus={invoker.current}
                title="LATAMWare Vault"
                navigation
                onClose={() => c.setMobileNav(false)}
            >
                {sidebar}
            </CompanyDialog>
            {c.newVault && (
                <CompanyDialog
                    returnFocus={invoker.current}
                    title={t("Create New Vault")}
                    onClose={() => c.setNewVault(false)}
                >
                    <form
                        className="cw-form"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void c.createVault()
                        }}
                    >
                        <p className="cw-dialog-description">
                            {t("Give this vault a name. You can share it with your team whenever you want.")}
                        </p>
                        <label className="cw-field">
                            <span>{t("Vault Name")}</span>
                            <input
                                className="cw-input"
                                value={c.vaultName}
                                onChange={(event) => c.setVaultName(event.target.value)}
                                maxLength={160}
                                placeholder={t("For example: Infrastructure")}
                                required
                                autoFocus
                                disabled={c.busy}
                            />
                        </label>
                        {c.error && (
                            <p role="alert" className="cw-dialog-description">
                                {t(c.error)}
                            </p>
                        )}
                        <div className="cw-form-foot">
                            <button
                                type="button"
                                className="cw-button cw-button-quiet"
                                onClick={() => c.setNewVault(false)}
                                disabled={c.busy}
                            >
                                {t("Cancel")}
                            </button>
                            <button type="submit" className="cw-button cw-button-primary" disabled={c.busy}>
                                <Icon name="plus" />
                                {t("Create New Vault")}
                            </button>
                        </div>
                    </form>
                </CompanyDialog>
            )}
            {c.renaming && c.vault && (
                <CompanyDialog returnFocus={invoker.current} title={t("Rename")} onClose={() => c.setRenaming(false)}>
                    <form
                        className="cw-form"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void c.perform(async () => {
                                await companyApi(`/vaults/${c.activeId}`, "PATCH", {
                                    name: c.vaultName,
                                    version: c.vault!.version
                                })
                                c.setRenaming(false)
                                await c.refresh()
                            })
                        }}
                    >
                        <label className="cw-field">
                            <span>{t("Vault Name")}</span>
                            <input
                                className="cw-input"
                                value={c.vaultName}
                                onChange={(event) => c.setVaultName(event.target.value)}
                                maxLength={160}
                                required
                                autoFocus
                            />
                        </label>
                        {c.error && <p role="alert">{t(c.error)}</p>}
                        <div className="cw-form-foot">
                            <button
                                type="button"
                                className="cw-button cw-button-quiet"
                                onClick={() => c.setRenaming(false)}
                            >
                                {t("Cancel")}
                            </button>
                            <button type="submit" className="cw-button cw-button-primary" disabled={c.busy}>
                                {t("Save")}
                            </button>
                        </div>
                    </form>
                </CompanyDialog>
            )}
            {c.editing && c.canEdit && (
                <CompanyDialog
                    returnFocus={invoker.current}
                    title={c.editing.id ? t("Edit item") : t("Add password or note")}
                    wide
                    onClose={() => c.setEditing(null)}
                >
                    <CompanyItemForm
                        key={c.editing.id ?? "new"}
                        initial={c.editing.content}
                        busy={c.busy}
                        onSave={c.saveItem}
                        onCancel={() => c.setEditing(null)}
                    />
                    {c.error && (
                        <p role="alert" className="cw-dialog-description cw-dialog-body">
                            {t(c.error)}
                        </p>
                    )}
                </CompanyDialog>
            )}
            {c.sharing && c.canManage && (
                <CompanyDialog
                    returnFocus={invoker.current}
                    title={t("Share this vault")}
                    onClose={() => c.setSharing(false)}
                >
                    <div className="cw-dialog-body">
                        <p className="cw-dialog-description">
                            {t(
                                "The invited person signs in with their own Google account. They will see only authorized vaults. No invitation email is sent."
                            )}
                        </p>
                        <form
                            className="cw-sharing-form"
                            onSubmit={(event) => {
                                event.preventDefault()
                                void c.perform(async () => {
                                    c.setMembers(
                                        await companyApi<CompanyMember[]>(`/vaults/${c.activeId}/members`, "POST", {
                                            email: c.inviteEmail,
                                            role: c.inviteRole
                                        })
                                    )
                                    c.setInviteEmail("")
                                })
                            }}
                        >
                            <label className="cw-field">
                                <span>{t("Email")}</span>
                                <input
                                    className="cw-input"
                                    type="email"
                                    placeholder={t("name@company.com")}
                                    value={c.inviteEmail}
                                    onChange={(event) => c.setInviteEmail(event.target.value)}
                                    required
                                    autoFocus
                                    disabled={c.busy}
                                />
                            </label>
                            <label className="cw-field">
                                <span>{t("Permission")}</span>
                                <select
                                    className="cw-input"
                                    value={c.inviteRole}
                                    onChange={(event) => c.setInviteRole(event.target.value)}
                                    disabled={c.busy}
                                >
                                    <option value="reader">{t("Read only")}</option>
                                    <option value="editor">{t("Edit")}</option>
                                    <option value="admin">{t("Manage access")}</option>
                                </select>
                            </label>
                            <button className="cw-button cw-button-primary" disabled={c.busy}>
                                <Icon name="user-plus" />
                                {t("Grant access")}
                            </button>
                        </form>
                        <div className="cw-members">
                            {c.members.map((member) => (
                                <div className="cw-member" key={member.id}>
                                    <span className="cw-avatar" aria-hidden="true">
                                        {member.email.slice(0, 2).toUpperCase()}
                                    </span>
                                    <div className="cw-member-info">
                                        <strong>{member.email}</strong>
                                        <small>
                                            {member.pending
                                                ? t("Pending first sign-in")
                                                : member.role === "owner"
                                                  ? t("Owner")
                                                  : t("Google connected")}
                                        </small>
                                    </div>
                                    {member.role === "owner" ? (
                                        <span className="cw-role">{t("Owner")}</span>
                                    ) : (
                                        <>
                                            <select
                                                className="cw-input"
                                                value={member.role}
                                                aria-label={t("Permission for {{email}}", {
                                                    email: member.email
                                                })}
                                                disabled={c.busy}
                                                onChange={(event) => {
                                                    const role = event.target.value
                                                    void c.perform(async () => {
                                                        c.setMembers(
                                                            await companyApi<CompanyMember[]>(
                                                                `/vaults/${c.activeId}/members`,
                                                                "POST",
                                                                { email: member.email, role }
                                                            )
                                                        )
                                                        await c.refresh()
                                                    })
                                                }}
                                            >
                                                <option value="reader">{t("Read only")}</option>
                                                <option value="editor">{t("Edit")}</option>
                                                <option value="admin">{t("Manage access")}</option>
                                            </select>
                                            <button
                                                className="cw-icon-button"
                                                aria-label={t("Remove access for {{email}}", {
                                                    email: member.email
                                                })}
                                                title={t("Remove access")}
                                                disabled={c.busy}
                                                onClick={() =>
                                                    c.setConfirmation({
                                                        title: t("Remove access"),
                                                        description: t("Remove access for {{email}}?", {
                                                            email: member.email
                                                        }),
                                                        label: t("Remove access"),
                                                        danger: true,
                                                        action: async () => {
                                                            await companyApi(
                                                                `/vaults/${c.activeId}/members/${member.id}`,
                                                                "DELETE"
                                                            )
                                                            if (member.email === c.me.email) {
                                                                c.setSharing(false)
                                                                c.selectVault("")
                                                                await c.refreshIndex()
                                                            } else await c.loadMembers()
                                                        }
                                                    })
                                                }
                                            >
                                                <Icon name="user-minus" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        <p className="cw-sharing-note">
                            <Icon name="shield-lock" />
                            {t("You can change or remove these permissions at any time.")}
                        </p>
                        {c.error && (
                            <p role="alert" className="cw-dialog-description">
                                {t(c.error)}
                            </p>
                        )}
                    </div>
                </CompanyDialog>
            )}
            {c.audit && (
                <CompanyDialog
                    returnFocus={invoker.current}
                    title={t("Activity")}
                    autoFocusField={false}
                    wide
                    onClose={() => c.setAudit(null)}
                >
                    <div className="cw-dialog-body">
                        <AuditIntegrity vaultId={c.activeId} />
                        <ActivityFeed vaultId={c.activeId} />
                    </div>
                </CompanyDialog>
            )}
            {c.importing && (
                <CompanyDialog
                    returnFocus={invoker.current}
                    title={t("Import and export")}
                    onClose={() => c.setImporting(false)}
                >
                    <Suspense
                        fallback={
                            <p className="cw-dialog-body" role="status">
                                {t("Loading…")}
                            </p>
                        }
                    >
                        <CompanyMigration vaults={c.vaults} onDone={c.refresh} onClose={() => c.setImporting(false)} />
                    </Suspense>
                </CompanyDialog>
            )}
            {c.confirmation && (
                <CompanyDialog
                    returnFocus={invoker.current}
                    title={c.confirmation.title}
                    onClose={() => c.setConfirmation(null)}
                >
                    <div className="cw-form">
                        <p className="cw-dialog-description">{c.confirmation.description}</p>
                        {c.error && (
                            <p role="alert" className="cw-dialog-description">
                                {t(c.error)}
                            </p>
                        )}
                        <div className="cw-form-foot">
                            <button
                                type="button"
                                className="cw-button cw-button-quiet"
                                onClick={() => c.setConfirmation(null)}
                                disabled={c.busy}
                            >
                                {t("Cancel")}
                            </button>
                            <button
                                type="button"
                                className={`cw-button ${c.confirmation.danger ? "cw-button-danger" : "cw-button-primary"}`}
                                disabled={c.busy}
                                onClick={() =>
                                    void c.perform(async () => {
                                        await c.confirmation!.action()
                                        c.setConfirmation(null)
                                    })
                                }
                            >
                                {c.confirmation.label}
                            </button>
                        </div>
                    </div>
                </CompanyDialog>
            )}
        </div>
    )
}
