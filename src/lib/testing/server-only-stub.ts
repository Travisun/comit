/**
 * vitest 专用 stub：`server-only` 包在测试（node 直载）环境会抛
 * "This module cannot be imported from a Client Component"。
 * vitest.config.ts 将其 alias 到本空模块，使依赖 server-only 的
 * 服务端模块（queries.ts 等）可被纯函数测试导入。
 */
export {};
