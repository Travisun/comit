/**
 * 扩展开发 CLI（Laravel artisan 对应物的最小实现）。
 *
 *   pnpm ext list            列出全部扩展及其声明的能力
 *   pnpm ext make <id>       脚手架一个新扩展（自动登记装配点与清单）
 *   pnpm ext test <id>       运行单个扩展的测试（vitest 过滤）
 *   pnpm ext routes          列出扩展页面
 *
 * 实现说明：直接以 tsx 运行 TS 源码，复用 src 内的清单/注册表模块。
 */
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const EXT_DIR = path.join(ROOT, "src", "extensions");

interface ExtPackage {
  name?: string;
  version?: string;
  description?: string;
  comit?: {
    server?: string;
    client?: string;
    slots?: string[];
    cron?: string[];
  };
}

async function readPackages(): Promise<{ id: string; pkg: ExtPackage }[]> {
  const dirs = await readdir(EXT_DIR, { withFileTypes: true });
  const out: { id: string; pkg: ExtPackage }[] = [];
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith("_")) continue;
    try {
      const raw = await readFile(path.join(EXT_DIR, d.name, "package.json"), "utf8");
      out.push({ id: d.name, pkg: JSON.parse(raw) as ExtPackage });
    } catch {
      // 无 package.json 的目录跳过
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function cmdList() {
  const list = await readPackages();
  console.log(`已安装扩展（${list.length}）：`);
  for (const { id, pkg } of list) {
    const caps = Object.entries(pkg.comit ?? {})
      .filter(([, v]) => (Array.isArray(v) ? v.length : Boolean(v)))
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`)
      .join(" ");
    console.log(`  ${id.padEnd(14)} v${pkg.version ?? "?"}  ${caps}`);
  }
}

async function cmdRoutes() {
  const { EXTENSION_PAGES } = await import("../src/extensions/_boot/registry");
  console.log("扩展页面（/e/<path>）：");
  for (const p of EXTENSION_PAGES) {
    console.log(`  /e/${p.path.padEnd(14)} layout=${p.layout.padEnd(4)} ${p.title}`);
  }
}

async function cmdTest(id: string) {
  const filter = path.join("src", "extensions", id);
  const r = spawnSync("pnpm", ["exec", "vitest", "run", filter], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

async function cmdMake(id: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error("扩展 id 需为小写字母/数字/连字符");
    process.exit(1);
  }
  const dir = path.join(EXT_DIR, id);
  await mkdir(path.join(dir, "tests"), { recursive: true });

  const pkg = {
    name: `@ext/${id}`,
    version: "1.0.0",
    private: true,
    description: `comit.sh 内置扩展：${id}`,
    comit: {
      server: "./server.ts",
      client: "./client.tsx",
    },
  };
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  await writeFile(
    path.join(dir, "manifest.ts"),
    `import type { ExtensionManifest } from "@/core/capabilities/manifest";

const manifest = {
  id: "${id}",
  title: { zh: "${id}", en: "${id}" },
  version: "1.0.0",
  // settingsFields / profileFields 按需声明（见 core/capabilities/manifest.ts）
} satisfies ExtensionManifest;

export default manifest;
`,
  );

  await writeFile(
    path.join(dir, "server.ts"),
    `import type { Plugin, PluginContext } from "@/core/plugins/types";
import manifest from "./manifest";

const plugin: Plugin = {
  name: manifest.id,
  description: manifest.title.en,
  version: manifest.version,
  register(ctx: PluginContext) {
    // ctx.registerPostRenderFilter / registerMediaProcessor / registerCron / ...
  },
};

export default plugin;
`,
  );

  await writeFile(
    path.join(dir, "client.tsx"),
    `"use client";

// 客户端注册在此执行（模块侧效）：
// registerNavItem / registerUserMenuItem / registerRailWidget /
// registerInterruptRenderer / registerUiPlugin
export function ${id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}Ready() {
  return true;
}
`,
  );

  // 自动登记：_boot/server.ts（导入 + PLUGINS）、_boot/client.tsx（导入）、_boot/manifests.ts
  const bootServer = path.join(EXT_DIR, "_boot", "server.ts");
  let s = await readFile(bootServer, "utf8");
  const importLine = `      const { default: ${id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}Plugin } = await import("@/extensions/${id}/server");`;
  if (!s.includes(`@/extensions/${id}/server`)) {
    const lastIdx = s.lastIndexOf('await import("@/extensions/');
    const lineStart = s.lastIndexOf("\n", lastIdx) + 1;
    s = s.slice(0, lineStart) + importLine + "\n" + s.slice(lineStart);
    s = s.replace("      const PLUGINS: Plugin[] = [", `      const PLUGINS: Plugin[] = [\n        ${id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}Plugin,`);
  }
  await writeFile(bootServer, s);

  const bootManifests = path.join(EXT_DIR, "_boot", "manifests.ts");
  let m = await readFile(bootManifests, "utf8");
  const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  if (!m.includes(`@/extensions/${id}/manifest`)) {
    const firstImport = m.indexOf("import ");
    const eol = m.indexOf("\n", firstImport) + 1;
    m = m.slice(0, eol) + `import ${camel}Manifest from "@/extensions/${id}/manifest";\n` + m.slice(eol);
    m = m.replace(
      /(export const EXTENSION_MANIFESTS: ExtensionManifest\[\] = \[)/,
      `$1\n  ${camel}Manifest,`,
    );
  }
  await writeFile(bootManifests, m);

  const bootClient = path.join(EXT_DIR, "_boot", "client.tsx");
  let c = await readFile(bootClient, "utf8");
  if (!c.includes(`@/extensions/${id}/client`)) {
    c = c.replace('import "@/extensions/poll/client";', `import "@/extensions/poll/client";\nimport "@/extensions/${id}/client";`);
    c = c.replace('import "@/extensions/share/client";', `import "@/extensions/share/client";\nimport "@/extensions/${id}/client";`);
    c = c.replace('import "@/extensions/signature/client";', `import "@/extensions/signature/client";\nimport "@/extensions/${id}/client";`);
  }
  await writeFile(bootClient, c);

  console.log(`已创建扩展 ${id}（src/extensions/${id}/）并登记装配点。`);
  console.log("下一步：实现 server.ts / client.tsx / manifest.ts，然后 pnpm dev 验证。");
}

async function main() {
  const [, , cmd, arg] = process.argv;
  switch (cmd) {
  case "list":
    await cmdList();
    break;
  case "routes":
    await cmdRoutes();
    break;
  case "make":
    if (!arg) {
      console.error("用法：pnpm ext make <id>");
      process.exit(1);
    }
    await cmdMake(arg);
    break;
  case "seed": {
    const { bootPlugins } = await import("../src/extensions/_boot/server");
    const { runSeeds } = await import("../src/core/capabilities/seeds");
    await bootPlugins();
    const done = await runSeeds();
    console.log(`seeded: ${done.join(", ") || "（全部已完成）"}`);
    break;
  }
  case "test":
    if (!arg) {
      console.error("用法：pnpm ext test <id>");
      process.exit(1);
    }
    await cmdTest(arg);
    break;
    default:
      console.log("用法：pnpm ext <list|make|test|routes|seed> [参数]");
  }
}
void main();
