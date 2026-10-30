# LATAMWare Vault

LATAMWare's fork of [VAULT](https://github.com/sizoLabs/vault), with a shared company workspace authenticated by Google and a separate compatibility mode for the original local vaults. Built with Astro, React, TypeScript, Node.js and Web Crypto. Licensed under MIT; original author attribution is retained in LICENSE.

## Development

Requirements: Node.js >=24.15.0 and pnpm 10.34.9.

`pnpm dev` loads `.env`, `.env.local`, and, on Windows, the private file `%LOCALAPPDATA%/LATAMWare/vault/.env.local` when present. `VAULT_ENV_FILE` can select another private file. Explicit process environment variables take precedence. Credentials, encryption keys and databases must stay outside the repository and cloud-synced project folders.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

```sh
pnpm check
pnpm test
pnpm build
pnpm test:auth:http
pnpm audit --audit-level=low
```

`test:auth:http` runs the built standalone server on temporary loopback ports with synthetic application sessions; it does not sign in to a real Google account. Production preview: `pnpm preview`, with corporate authentication configured as below. To deliberately preview the original local-only mode, set `VAULT_AUTH_MODE=local`. Production container deployment is described in [COOLIFY.md](COOLIFY.md).

## Corporate Google login and access policy

The server supports Google OpenID Connect login through Auth.js. Set the private runtime variables in `.env.example`: `VAULT_AUTH_MODE=google`, `VAULT_AUTH_ORIGIN`, `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET` and a cryptographically random `AUTH_SECRET` of at least 32 bytes. Generate the secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`; never commit it or put it in a `PUBLIC_` variable. These credentials are independent of the browser-only Drive integration.

Configure a Web application OAuth client in Google Cloud with redirect URI `<VAULT_AUTH_ORIGIN>/api/auth/callback/google`. For the development origin in `.env.example`, this is `http://127.0.0.1:4321/api/auth/callback/google`. Google login requests only `openid email profile`. Use an **external** audience to admit other Workspace organizations or personal Gmail accounts; Google's internal audience restricts sign-in to one organization. While the consent configuration is in Testing, add the external testers there as well. Configure production publishing and any requirements shown by Google before rollout.

The two server-side allowlists are combined with OR:

| Variable | Initial value | Effect |
| --- | --- | --- |
| `VAULT_ALLOWED_DOMAINS` | `latamware.com` | Every verified Google Workspace identity with that exact email domain and matching hosted-domain claim |
| `VAULT_ALLOWED_EMAILS` | empty | Only the exact listed, verified Google email identities |

Values are comma-separated and case-insensitive. Future example: `VAULT_ALLOWED_DOMAINS=latamware.com,iguapp.tur.ar` and `VAULT_ALLOWED_EMAILS=dapris12@gmail.com`. The additional domain and personal email are examples, not enabled defaults. Explicitly empty domains permits email-only access if at least one email is configured. An entirely empty policy, invalid rules or incomplete Google configuration fails closed. Wildcards and implicit subdomains are unsupported; list each domain explicitly. Gmail aliases, dots and `+` addresses are not silently equated. Google supplies the verified identity; entering a permitted email manually grants nothing. See [Google's hosted-domain validation requirements](https://developers.google.com/identity/openid-connect/openid-connect).

Production defaults to Google mode; development defaults to local mode. Explicit local mode has no server access gate and is intended for the standalone local application. Google mode protects application pages and API routes. Assets and the readiness endpoint `/api/health` remain public. Missing corporate configuration returns 503, including on readiness. Keep the public deployment origin fixed; request/forwarded host headers do not select OAuth redirect targets.

Allowlist changes take effect after updating the server environment and restarting the application, and are checked on each session read. The company workspace refreshes every 15 seconds and when refocused. Every API request validates the session and current database permissions. Disabling a user or closing their sessions takes effect on subsequent requests; an already displayed copy cannot be erased remotely. Google sessions require fresh sign-in after one hour even with continuous activity. Cookies are HttpOnly and SameSite=Lax, with Secure over HTTPS; Auth.js handles OAuth state, PKCE, nonce, CSRF and session encryption. Google account deactivation is observed at the next Google authentication, not by a background Workspace directory sync. Enforce two-step verification through Workspace/Google policy; this application does not independently verify that a personal Gmail account has MFA enabled.

Google mode now opens the company workspace directly: there is no second account or master-password creation step. Identity is keyed by Google's immutable `sub`. Users see only their own and explicitly shared vaults. Owners can create passwords/notes, share by exact email, choose reader/editor/vault-administrator permissions and remove access. Invitations bind to a verified Google identity on first sign-in; no invitation emails are sent. Invited addresses must also satisfy the deployment allowlist. Readers can read/copy, editors can modify items, vault administrators can manage members, and owners can delete the vault. Memberships are enforced server-side, including item IDs supplied from another vault. Versions reject stale concurrent writes instead of silently overwriting them.

## Central storage, administration and recovery

Company mode requires `VAULT_DATABASE_PATH` (an absolute persistent SQLite filename), `VAULT_ADMIN_EMAILS`, `VAULT_ENCRYPTION_KEYS` (a JSON object of independent 32-byte Base64 encryption keys), and `VAULT_ACTIVE_KEY_ID`. See `.env.example`. Generate encryption material with a cryptographic random generator and store it privately; never reuse `AUTH_SECRET`. Missing, malformed or wrong required encryption keys fail closed. Node 24's built-in `node:sqlite` is used. This deployment supports **one application instance with a local persistent disk**; do not put its live SQLite/WAL files on OneDrive, NFS or a shared network filesystem, or scale replicas against separate copies. A distributed deployment needs a transactional shared database adapter before scaling.

Each company vault has its own random AES-256 key. The database stores that key wrapped with the active server key using AES-256-GCM. Item titles, usernames, passwords, URLs and notes are encrypted as a payload with a fresh nonce; authenticated data binds ciphertext to its vault, item ID and version. Vault names, membership identities and audit metadata are visible to the database operator. **The application server can decrypt company credentials after authorization. This is server-managed encryption, not zero-knowledge/client-only encryption.** Keep HTTPS, the host and encryption-key storage protected. The company UI does not persist decrypted credentials or its encryption keys in localStorage.

System administrators are the explicitly configured, verified Google email identities in `VAULT_ADMIN_EMAILS`; there is no first-user administrator bootstrap. The first administrator creates the initial `General` vault. A normal allowed user is not automatically a system administrator and is not automatically a member of company vaults. Administrators can disable users, revoke sessions, view change/security audit records and explicitly recover vault-administrator access. Recovery is logged and does not silently grant blanket read access. Audit records cover changes, grants/removals, account status, session revocation and recovery; they do not contain credential payloads. Copy-button requests for passwords, usernames and notes, plus exports, are also audited with the authenticated actor, timestamp and item title. No copied value is stored in the log. A copy request is recorded before the browser writes to the clipboard: a browser denial can leave an attempted copy in the log. Manual copies, operating-system clipboard use and actions outside these controls cannot be observed. Vault owners/administrators can browse the full vault history, and system administrators the full global history, in pages of 100 events with previous/next arrows. User/item search is debounced and action selection uses an accessible custom dropdown. Pagination retains a snapshot ID so concurrent new events do not shift or duplicate older pages; refresh starts a new snapshot. No audit records are removed by the page size. New vault events store their names; historical vault UUID targets resolve to the current name while that vault still exists. Historical item events retain their original ID targets; new item changes include the title. There is no SMTP dependency or automatic access notification.

Losing a Google second factor is handled through Google/Workspace recovery. No company master password needs resetting. Losing **all copies of the server encryption keys** makes encrypted database backups unreadable: preserve those keys separately. The operator can keep old keys in the key ring while introducing a new active key; new vaults use the active key. `CompanyStore.rotateWrappingKeys()` transactionally rewraps existing vault keys; key rotation/restore is tested but no public rotation UI is exposed. Keep old key versions until backups requiring them have expired.

Create a consistent encrypted database snapshot with `pnpm company:backup /absolute/new/backup.sqlite`; the development helper reads the private environment file without displaying it. In a container use `node scripts/company-backup.mjs /app/data/backups/backup.sqlite`. Existing files are not overwritten. This uses SQLite `VACUUM INTO`, so committed WAL data is included; copying the live main file alone is not a reliable backup. Restrict backup permissions and preserve the matching encryption key ring **separately**. To restore, stop the application, select the restored database path and its matching key ring, restart one instance, and verify data and permissions before reopening access. Restoring an old snapshot also restores old permissions and revocation timestamps; rotate `AUTH_SECRET` on restoration to invalidate pre-restore cookies and review access changes.

## Migrating previous local vaults

Choose **Import and export → From this browser** in the company sidebar on the browser that holds the original data. The old master password is used only in that browser to decrypt and materialize previous generated passwords. The server receives the credential content over HTTPS and encrypts it under independent company keys; it never receives the old master password, its verifier, generation seeds or OAuth credentials. Original browser data is not deleted or modified. The import is one transaction, private to the importer until explicitly shared, and idempotent per Google identity/local-account ID. Repeating an import returns the original receipt; it is not incremental synchronization. Limits are 4 MiB/request, 200 vaults, 5,000 items/vault and 128 KiB note text. Failed or oversize imports leave the source intact. Accounts without a usable verifier or encrypted data cannot reliably verify an old generated-password master key and must be verified in local mode first. To migrate another browser/address, use **Import file** to select an encrypted `.vault` backup directly and enter the original master password. It is decrypted and validated locally without creating/restoring a local account or replacing browser storage. Legacy `.ovni` files must first be converted/exported as `.vault` in local mode. The corporate file picker accepts up to 6 MiB; the decrypted import still has the 4 MiB request limit.

## Personal pins, copy controls and portable backups

Every member, including a reader, can pin/unpin items. Pins belong to the current Google identity, persist across devices in SQLite and sort before other items within each vault. They do not change a shared item version or anyone else’s ordering. Removing vault access blocks subsequent pin, copy and export requests.

Password entries have separate controls to copy the password and the username (when present). Copy requests recheck current server permissions and retrieve the current value; clipboard failures show an error. The app never writes copied credentials to localStorage.

**Import and export → Export backup** lets members select only vaults they can access and download an encrypted `.latamvault` file. A new backup password of at least 12 characters encrypts the full portable payload in the browser with the existing PBKDF2/AES-GCM format; it is never sent to the server. The server delivers authorized plaintext over HTTPS before browser encryption, as in ordinary vault reads. The portable file contains credential data, vault names and the language preference. Sharing permissions, personal pins, activity, Google sessions, deployment configuration and server keys are excluded. It is a user data export, not a replacement for the full SQLite/key-ring operational backup.

Restore from **Import file** with the backup password. Restoration creates private vaults owned by the importer; share them explicitly afterwards. It never overwrites existing vaults. The same file has a stable import receipt, so retries by that identity do not duplicate it. Exporting again creates a new snapshot/receipt. The saved language preference can optionally be restored. Wrong passwords, corrupt payloads or permission failures do not partially import data. Keep the file and password separately; the server cannot recover a lost portable-backup password. Large exports must be split into selections below the 4 MiB decrypted payload limit.

The initial authenticated HTML already includes the authorized vault index without any credential content. The client avoids a duplicate startup fetch, refreshes independent index/detail requests concurrently, coalesces background polls and pauses them while hidden. Routine authentication still checks revocation on every request, with last-seen writes throttled to once per minute.

## Verifiable audit seals

Google mode automatically seals new audit records in five-minute batches. A background worker starts after the first configured request/readiness check, checks eligible scopes every minute and handles at most five new submissions per tick. It creates both global and per-vault batches, retries failed submissions, and revisits pending proofs periodically until they have six Bitcoin confirmations. These network operations are outside login and ordinary vault reads. This requires the existing continuously running single Node instance; suspended/serverless runtimes need an external job runner. Set `VAULT_AUDIT_AUTO=false` only to deliberately disable automatic work.

Activity retains four controls: Verify integrity, Seal activity (manual override/testing), receipt download and Check on Bitcoin. The last opens the confirmed block in mempool.space and remains disabled while no confirmed block exists. The displayed status is plain language, including “Awaiting verification”; a calendar acknowledgement never counts as Bitcoin confirmation. The latest seal is shown, and the server validates the entire saved seal chain and its raw records.

Each manifest commits to up to 5,000 raw events, their IDs, scope, random salt and previous manifest digest. Individual events become salted SHA-256 fingerprints; creator identity is also salted. Display-name resolution is excluded from canonical hashing, so renaming a vault does not invalidate historical seals. Only a randomized 32-byte commitment goes to the fixed HTTPS Alice/Bob OpenTimestamps calendars. No passwords, usernames, emails, Google tokens, event contents or manifests are uploaded. Calendar redirects/arbitrary proof URLs are not followed, and response/proof sizes, operation depth and network timeouts are bounded. Existing raw events remain in SQLite; schema v3 adds seal receipts without replacing them.

Verification checks the proof's SHA-256 digest, replays its operations and compares the resulting Merkle root against a raw Bitcoin block header returned consistently by Blockstream and mempool.space. The header hash and at least six confirmations must match. This is verification using two public providers, not an independently validating Bitcoin node. Keep independently stored receipts/SQLite backups: modifications/deletions of sealed records and broken retained chains are detected, but a server cannot discover an erased final receipt without an external copy. Unsealed activity and the truth/completeness of originally recorded events remain outside this guarantee.

Downloaded JSON receipts contain a canonical fingerprint manifest and a standard base64 `.ots` proof. Verify a receipt from an independent checkout/container with `pnpm company:audit:verify --receipt /absolute/path/receipt.json` (Node 24.15+; no Google credentials or encryption keys). It returns exit 0 for confirmed, 2 for pending, and 1 for invalid/unavailable. For verification with Bitcoin Core, extract the manifest string verbatim as UTF-8 and decode the ots field to a sibling `.ots` file, then use the official OpenTimestamps client. The external receipt proves the manifest existed, while comparing private event rows to its fingerprints requires the original private history. It is not an external user-identity lookup.

The unmodified server dependency `@vitrified/typescript-opentimestamps@0.2.2` is LGPL-3.0-or-later; its included license/source links are retained. It is used for the OpenTimestamps file codec, with networking and supported Bitcoin proof operations controlled by this application. Upstream: https://github.com/vitrified-glass/typescript-opentimestamps; protocol: https://opentimestamps.org/.

## Installable web app and search exclusion

The app includes a standalone web manifest, padded 192/512 PNG icons, Apple home-screen metadata and an Install app action in the company menu. Supported browsers show their native installation prompt; Safari/other browsers receive short platform instructions. HTTPS or localhost is required. Google login and the same server permissions continue to apply in the installed app.

The service worker is network-only. It never stores authenticated HTML, API responses or credentials in Cache Storage; offline navigation shows a generic connection message without any vault data. APIs, OAuth routes, other origins, POSTs and subresource requests are not intercepted. Ordinary static browser asset caching remains separate from vault data.

Runtime HTML/redirect/error/API responses carry X-Robots-Tag noindex/nofollow and layouts include matching meta directives. Sitemap routes return 410 and no sitemap is advertised. Public HTML remains crawlable so compliant search engines can actually read noindex; robots.txt blocks API/assets and retains the prior AI-crawler exclusions. Blocking every HTML URL in robots.txt would prevent crawlers reading noindex. These are indexing instructions, not access control: authentication protects private data. Previously indexed URLs require recrawling or a Search Console removal request; removal is not instantaneous or guaranteed for noncompliant crawlers.

## Languages

The interface supports Spanish and English through i18next and react-i18next. An animated flag dropdown appears in the desktop sidebar and mobile navigation. It closes on outside click, Escape or focus leaving it, and supports arrow-key selection. Native modal dialogs trap focus, return focus on close and place initial focus in the first field. Visible keyboard focus and reduced-motion support are retained. The mobile navigation fills the viewport and animates opening/closing, with immediate transitions when reduced motion is requested. Scrollbars use a consistent custom palette and rounded thumbs across the page, dialogs and lists. Delegated custom tooltips work on hover and keyboard focus, support Escape and preserve accessible descriptions, including controls added inside dialogs. A manual language selection is stored separately from vault data under `vault:language`; otherwise the browser's language is used, with English as fallback.

The Spanish catalog is `src/locales/es.json`. English source messages are the catalog keys. Add a language by supplying a matching catalog, registering it in `src/logic/i18n.ts`, and adding its selector button. Preserve all interpolation variables. User-entered account names, service identifiers and secrets are never translated. Switching languages does not reload or lock an open account.

The FAQ and interactive generator demonstration describe the current format. Marketing copy and the legal-notice footer are not shown on the access or home screen; LICENSE remains in the repository.

## Local compatibility mode: data and password generation

Accounts, vaults, service identifiers, character sets and settings live in browser localStorage. Secret contents, descriptions and preserved service passwords are encrypted. Names, URLs and other organizational metadata are not encrypted locally. The master password is held in memory, never persisted as plaintext.

New services use a versioned PBKDF2-SHA-256 derivation (600,000 iterations), followed by HMAC-SHA-256 expansion and unbiased character selection. The identifier, alphabet identifier, exact character set and password rotation version are part of the derivation. The same inputs and algorithm reproduce the same password. Password length is limited to 1–1024 characters.

Existing services without an algorithm field retain the legacy SHA-512/random-seed algorithm and their exact passwords. Changing generation inputs or the rotation version explicitly moves that service to the new derivation. Updating the application never silently rotates a password. External service passwords must be changed at the external service when intentionally rotating them.

Alphabets used by services cannot be deleted or have their identifier/characters modified. Create a new alphabet and select it explicitly when rotating a service.

## Local compatibility mode: encryption and migration

All newly encrypted data uses a `vault:v2:` envelope: Base64-encoded salt (16 bytes), random GCM nonce (12 bytes), ciphertext and authentication tag. Keys use PBKDF2-SHA-256 with 600,000 iterations and AES-256-GCM. The format prefix is authenticated as additional data. Unsupported versions, invalid passwords and authentication failures are rejected.

Legacy Base64 salt + IV + AES-256-CBC data remains readable with its original PBKDF2 cost (100,000 iterations). Historical CBC data has no authentication tag; its integrity cannot be retroactively proven. Import validates the full account schema and references and reencrypts legacy secret fields with GCM before a single commit. Invalid files never replace current data. Old `.ovni` imports are normalized before validation.

New backups are not readable by older VAULT versions. Export a backup before upgrading and keep the original file until you have verified the new installation. Import accepts files up to 32 MiB; browser storage quotas may impose a lower account-size limit.

## Local compatibility mode: changing the master password and sessions

Changing the master password verifies the current password, decrypts and reencrypts every secret and description, and preserves each service's existing password encrypted under the new password. A metadata-only edit retains that preserved password; changing generation inputs or the rotation version produces a new password. No external service password is changed automatically.

The operation commits once, after every field has succeeded. A bad key, corrupt secret, concurrent edit or storage error leaves the prior account intact. Keep an encrypted backup and retain old backup passwords for old backups.

A confirmation modal defaults to closing other sessions of the same account. Revocation applies to other open tabs of this browser profile and origin. When sessions are retained, already-open tabs receive an ephemeral encrypted handoff through BroadcastChannel; the handoff is not saved in storage or backups. If it cannot be decrypted, the tab locks. Other accounts are unaffected.

The master-password modal applies to local vault sessions; it does not revoke corporate Google sessions, other browser profiles, devices or the independent Chrome extension. The corporate login gate described above has a separate session lifecycle. Signing into Google Drive is authorization for backups, not centralized vault authentication.

## Backups and integrations

File export encrypts the entire account and omits OAuth credentials and session control state. Google Drive stores encrypted backups in the app-data folder, supports paginated listings, and validates downloads before replacement. Push/pull are explicit snapshot operations, not a shared team database. Concurrent remote edits are not merged.

Google Drive is optional. Configure your own Google Cloud project, enable Drive API, and set `PUBLIC_GOOGLE_CLIENT_ID`. Authorize the deployment's exact HTTPS origin. Access tokens live in sessionStorage and are cleared when disconnecting, resetting or deleting an account. Credentials and permissions are never required for local use.

Chrome extensions must acknowledge compatibility with `pbkdf2-v2`, `encrypted-service-passwords` and/or `master-verifier-iterations` before an account using those features is sent. Older extensions are rejected with an explanatory message. The extension is a separate repository; its implementation is not included here. Replies must match the originating window, origin and request ID.

## Security and deployment

Serve the application over HTTPS; localhost also supports Web Crypto. Self-hosting does not protect against a compromised device, malicious extensions or malicious JavaScript served by the deployment. This fork has automated regression checks, not an independent cryptographic audit.

Local accounts are browser profiles, separate from corporate Google identities. Their local-only restrictions still apply in compatibility mode; company mode uses the separate shared backend described above. Clearing legacy browser storage without a backup loses the metadata needed to recover its generated services.

CI checks types, regression tests, production build and dependencies before releases. Docker Compose builds this fork from source instead of pulling the upstream image.
