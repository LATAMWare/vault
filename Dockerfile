# Build stage
FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

RUN npm install --global pnpm@10.34.9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

# Production stage
FROM node:24.15.0-bookworm-slim AS production

WORKDIR /app

RUN npm install --global pnpm@10.34.9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY scripts/company-backup.mjs ./scripts/company-backup.mjs
COPY scripts/private-env.mjs ./scripts/private-env.mjs
COPY scripts/audit-verify.mjs ./scripts/audit-verify.mjs
COPY src/server/audit-ots.ts ./src/server/audit-ots.ts

RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

USER node

EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
