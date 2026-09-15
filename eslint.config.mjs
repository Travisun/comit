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
  ]),
  {
    // 前端数据流守卫（docs/frontend-architecture.md §1 铁律 1）：
    // 浏览器侧组件/页面禁止直接 fetch —— 读取用 TanStack Query
    // （apiQueryOptions + useQuery），请求用 @/lib/client/api。
    // 服务端出站调用（OAuth/webhooks/LLM）位于 src/lib、src/plugins、
    // src/app/api，不在本规则范围。
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**/*.ts"],
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
