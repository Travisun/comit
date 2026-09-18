# syntax=docker/dockerfile:1
# 生产镜像：多阶段构建（deps → build → runner），非 root 运行，standalone 优先。
# 构建上下文 = 仓库根（pnpm monorepo：src/extensions/* 为 workspace 包）。

FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm patchedDependencies（pnpm-workspace.yaml 引用）：锁文件安装期即需补丁文件
COPY patches ./patches
# workspace 包（src/extensions/*）的 package.json 一并还原，pnpm 才能解析
COPY src/extensions ./src/extensions
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# runner 阶段需要 pnpm（CMD pnpm start / migrate one-shot pnpm db:migrate）。
# 版本须与 package.json 的 packageManager 保持一致；用 npm 全局安装而非
# corepack —— 后者首跑时才下载 pnpm，容器启动会依赖外网且偶发抖动。
RUN npm install -g pnpm@12.3.4
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=app:app /app/src/db ./src/db
COPY --from=build --chown=app:app /app/src/extensions ./src/extensions
# migrate one-shot（tsx）需要 tsconfig.json 解析 @/* 路径别名（schema.ts →
# @/extensions/_boot/tables）
COPY --from=build --chown=app:app /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=app:app /app/next.config.ts ./next.config.ts
USER app
EXPOSE 3000
CMD ["pnpm", "start"]
