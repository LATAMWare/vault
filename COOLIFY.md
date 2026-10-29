# Deploying LATAMWare Vault with Coolify

The repository's Docker Compose configuration builds the LATAMWare fork from source. It does not pull the upstream `sizolabs/vault:latest` image. `pull_policy: build` forces source builds even when an image with the same name is cached; see the [Compose build rules](https://docs.docker.com/reference/compose-file/build/).

## Deploy from the fork

1. Add the repository `https://github.com/LATAMWare/vault` to Coolify.
2. Select Docker Compose and use the committed `docker-compose.yaml`.
3. Set the public domain and direct the proxy to port 4321, or to the configured `PORT`.
4. Require HTTPS so Web Crypto and the clipboard work.
5. Configure the corporate Google login variables and allowlists described in README. Set `VAULT_AUTH_ORIGIN` to the exact public HTTPS origin. For an intentionally local-only installation, explicitly set `VAULT_AUTH_MODE=local` instead.
6. Optionally set `PUBLIC_GOOGLE_CLIENT_ID` at runtime for Drive backups.
7. Configure `VAULT_ADMIN_EMAILS`, `VAULT_ENCRYPTION_KEYS` and `VAULT_ACTIVE_KEY_ID` as private runtime variables. Compose sets `VAULT_DATABASE_PATH=/app/data/company.sqlite` and mounts the persistent `vault-data` volume. Preserve the encryption key ring separately from database backups.
8. Build and deploy **one replica**. Verify Google admission/rejection, sharing with a reader and editor, access removal, and backup/restore with disposable data before entering real credentials.

For a local container build:

```sh
docker compose up --build -d
```

The image uses Node.js 24.15.0 and pnpm 10.34.9 with a frozen lockfile. It runs as the unprivileged `node` user. The health check requests `/api/health`; incomplete corporate auth/storage configuration or missing encryption keys returns 503. Company data is in the persistent `vault-data` volume. Do not remove that volume on rebuild or rollback. Use the snapshot command in README and preserve encryption keys separately; a container/image backup alone does not preserve them. Browser-local legacy data must be imported or exported separately.

To add access later, update `VAULT_ALLOWED_DOMAINS` and/or `VAULT_ALLOWED_EMAILS` in Coolify and restart the application. For example, `latamware.com,iguapp.tur.ar` admits both Workspace domains, and an exact-email rule can admit a personal Google account without admitting all Gmail users. Repository defaults do not grant external users or administrator privileges. Google must use an external OAuth audience for cross-organization/personal identities. Application admission and membership of a vault are separate: share each vault explicitly.

If using a registry image, build and publish the LATAMWare source first, then deliberately replace the Compose build/image entries with an immutable tag or digest from your registry. The GitHub image workflow targets the current repository's GHCR namespace.

## Google Drive

Google Drive is optional and applies to legacy local mode. Company data uses the central database, not Drive snapshots.

1. Create a LATAMWare-owned Google Cloud project and enable Google Drive API.
2. Configure the OAuth consent screen and audience. Use an internal audience only if the deployment is restricted to your Google Workspace organization.
3. Create a Web application OAuth client and authorize the exact deployment origin, including HTTPS. Do not enter a path or trailing slash.
4. Set `PUBLIC_GOOGLE_CLIENT_ID` to the public client ID ending in `.apps.googleusercontent.com`. No client secret is used by the browser flow.
5. Redeploy, connect from Settings, and verify push and pull with a test account.

Google backup authorization does not authenticate users to the vault. Snapshot restores replace local data after validation; they do not merge concurrent edits.

## Updates and rollback

Before upgrading, export an encrypted backup from each browser account and verify that it can be restored. New `vault:v2:` backups require this fork's new reader. Retain the old backup and old master password until migration is verified. Rebuilding an older application image does not reverse data-format changes in browser storage.

CI validates the application before creating a release. Build the selected source revision again to deploy changes; restarting an old container does not incorporate repository changes.
