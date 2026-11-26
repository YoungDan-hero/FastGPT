# --------- install dependence -----------
FROM node:24.22.1-bookworm-slim AS maindeps
WORKDIR /app

ARG proxy

RUN [ -z "$proxy" ] || sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources
RUN npm install -g pnpm@10.33.4

# copy packages and one project
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .npmrc ./
COPY ./packages ./packages
COPY ./sdk ./sdk
COPY ./projects/app/package.json ./projects/app/package.json

RUN [ -f pnpm-lock.yaml ] || (echo "Lockfile not found." && exit 1)

# The production build uses jsdom without its optional native canvas peer.
ENV HUSKY=0 MONGOMS_DISABLE_POSTINSTALL=1
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    sed -i '/^  - canvas$/d' pnpm-workspace.yaml && \
    if [ -z "$proxy" ]; then \
        pnpm install --frozen-lockfile; \
    else \
        pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com; \
    fi

# --------- builder -----------
FROM maindeps AS builder
ARG base_url
ARG BUILD_NODE_HEAP_MB=5632

COPY eslint.config.mjs ./
COPY ./projects/app ./projects/app

ENV NODE_OPTIONS="--max-old-space-size=${BUILD_NODE_HEAP_MB}"
ENV NEXT_PUBLIC_BASE_URL=$base_url
ENV NEXT_TELEMETRY_DISABLED=1
# The dependency stage's postinstall builds the SDK and workflow workspace packages.
# Use the Webpack production build to avoid the Turbopack worker shutdown stall.
RUN pnpm --filter=app build:webpack

# Remove build-time-only packages from standalone output before copying to runner.
RUN rm -rf projects/app/.next/standalone/node_modules/.pnpm/typescript@*/ \
    projects/app/.next/standalone/node_modules/.pnpm/*-linux-x64-musl@*/

# --------- runner -----------
FROM node:24.22.1-bookworm-slim AS runner
WORKDIR /app

ARG proxy
ARG base_url

# create user and use it
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 -g nodejs nextjs

RUN [ -z "$proxy" ] || sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources \
  && node -e "require('fs').writeFileSync('/tmp/node-ca.crt', require('tls').rootCertificates.join('\n') + '\n')" \
  && apt-get -o Acquire::https::CaInfo=/tmp/node-ca.crt -o Acquire::Retries=2 update \
  && apt-get -o Acquire::https::CaInfo=/tmp/node-ca.crt -o Acquire::Retries=2 \
    install -y --no-install-recommends curl ca-certificates procps \
  && rm -rf /var/lib/apt/lists/* /tmp/node-ca.crt

# copy running files
COPY --from=builder /app/projects/app/public /app/projects/app/public
COPY --from=builder /app/projects/app/next.config.ts /app/projects/app/next.config.ts
COPY --from=builder /app/projects/app/next-i18next.config.js /app/projects/app/next-i18next.config.js
COPY --from=builder --chown=nextjs:nodejs /app/projects/app/.next/standalone /app/
COPY --from=builder --chown=nextjs:nodejs /app/projects/app/.next/static /app/projects/app/.next/static
# next-i18next loads locale json files from ../../packages/web/i18n at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/i18n /app/packages/web/i18n
# copy server chunks
COPY --from=builder --chown=nextjs:nodejs /app/projects/app/.next/server/chunks /app/projects/app/.next/server/chunks
# copy worker
COPY --from=builder --chown=nextjs:nodejs /app/projects/app/worker /app/projects/app/worker
COPY --from=builder --chown=nextjs:nodejs /app/projects/app/worker /app/worker
# LiteParse is externalized from the worker bundle and loads this file at runtime.
RUN test -f /app/worker/node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm

# anydoc is a N-API package; loading it here verifies that the matching gnu binary was packaged.
RUN node -e "require('/app/worker/node_modules/@fastgpt-sdk/anydoc')"

COPY --from=maindeps /app/node_modules/@zilliz/milvus2-sdk-node ./node_modules/@zilliz/milvus2-sdk-node

# copy package.json to version file
COPY --from=builder /app/projects/app/package.json ./package.json
# 用于 STT 测试
COPY --chown=nextjs:nodejs ./projects/app/data/test.mp3 /app/data/test.mp3
# 用于 IP 推测
COPY --chown=nextjs:nodejs ./projects/app/data/GeoLite2-City.mmdb /app/data/GeoLite2-City.mmdb

# 辅助脚本用于重置 root 密码
COPY --from=builder --chown=nextjs:nodejs /app/projects/app/scripts/dist/reset-root-password.cjs /app/scripts/reset-root-password.cjs
RUN RESET_ROOT_PASSWORD_SELFTEST=1 node /app/scripts/reset-root-password.cjs


ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV NEXT_PUBLIC_BASE_URL=$base_url

EXPOSE 3000

USER nextjs

ENTRYPOINT ["node","--max-old-space-size=4096","./projects/app/server.js"]
