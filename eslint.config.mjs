import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 第三方产物与工具状态：public/ 内含 vditor 等 vendored 产物（~3000 个
    // minified 代码风格 error），.codex/ 为 agent 工具状态，均非源码门禁对象。
    "public/**",
    ".codex/**",
    // agent 并行工作区（worktree 整体镜像仓库）与本地 AI 工具状态，非源码门禁对象
    ".qoder/**",
    ".cursor/**",
    ".opencode/**",
    // 双轨发布通道：只在本地手动执行的一次性运维脚本（含 work 克隆），非产品源码
    ".oss/**",
    "storage/**",
    // 本地诊断/并行 dev 构建产物（.gitignore 已排除，不应成为 lint 门禁对象）
    ".next-diag/**",
    ".next-test/**",
    "ComitDocuments/**",
    "patches/**",
    "logos/**",
  ]),
  {
    rules: {
      // "_前缀 = 有意保留的占位参数"（如 createCronCapability(_hooks) 公开签名）
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 前端数据流守卫（docs/frontend-architecture.md §1 铁律 1）：
    // 浏览器侧组件/页面禁止直接 fetch —— 读取用 TanStack Query
    // （apiQueryOptions + useQuery），请求用 @/lib/client/api。
    // 服务端出站调用（OAuth/webhooks/LLM）位于 src/lib、src/plugins、
    // src/app/api，不在本规则范围。
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: [
      "src/app/api/**/*.ts",
      // 第二豁免（有意为之）：src/lib/client/error-report.ts 是错误上报通道，
      // 必须零依赖裸 fetch —— 错误边界崩溃时 api.ts 本身可能就是嫌疑对象；
      // keepalive fire-and-forget 语义也与传输层不同。除此之外浏览器侧
      // 一律禁直接 fetch（架构铁律 1）。
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "禁止直接 fetch：读取用 useQuery(apiQueryOptions(...))，请求用 @/lib/client/api 的 postJson/requestSafe 系列",
        },
      ],
    },
  },
]);

export default eslintConfig;
