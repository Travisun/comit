/**
 * 扩展清单（manifest）— VS Code `contributes.*` 风格的**声明式**扩展点。
 * 纯数据模块（`extensions/<id>/manifest.ts`），服务端与客户端都可导入：
 *  - 设置字段声明 → 设置页「扩展」tab 自动渲染表单 + 服务端校验
 *  - 资料字段声明 → 资料编辑表单 + 主页「关于」展示
 * 命令式扩展点（过滤器/处理器/组件）不走 manifest，见 core/capabilities/*。
 */

export type SettingFieldType = "text" | "textarea" | "number" | "boolean" | "select" | "radio";

export interface SettingFieldDef {
  /** 扩展内的设置键（存储时自动加 `ext.<id>.` 前缀） */
  key: string;
  type: SettingFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean;
  /** type = "select" 时的选项 */
  options?: { value: string; label: string }[];
  /** type = "text" | "textarea" 时的长度上限 */
  maxLength?: number;
}

export interface ProfileFieldDef {
  /** 存储键，约定 `ext.<id>.<field>` */
  key: `ext.${string}`;
  type: "text" | "textarea" | "url";
  label: string;
  description?: string;
  placeholder?: string;
  maxLength?: number;
}

export interface ExtensionManifest {
  /** 扩展命名空间文案（键约定 ext.<id>.<key>，getT 的 tExt 读取） */
  i18n?: { zh: Record<string, string>; en: Record<string, string> };
  /** 全局唯一，同时作为路由/存储命名空间：/api/ext/<id>/、ext.<id>.* */
  id: string;
  title: { zh: string; en: string };
  description?: { zh: string; en: string };
  version: string;
  /**
   * 权限声明（能力白名单，app-store 模型）：
   * 未声明 = 全量信任（内置扩展兼容）；声明后仅列出的能力在 ctx 中可用，
   * 未声明能力以「拒绝存根」注入（调用即抛错并告警）。
   * 键与 PluginContext 一致：events / hooks / registerChannel / registerMcpTool /
   * registerPostRenderFilter / registerMediaProcessor / registerSitemapSource /
   * registerExtApiRoute / cron / llm / storage / policies / jobs / notifications /
   * broadcast / search / middleware / flags / seeds
   */
  permissions?: string[];
  /**
   * 信任分级：trusted（默认，本仓库一等公民，渲染输出不过强制净化）；
   * untrusted（外部交付，渲染输出强制过净化白名单）。
   */
  trust?: "trusted" | "untrusted";
  /** 来源元数据（分发展示用） */
  author?: string;
  license?: string;
  homepage?: string;
  /** 注册到 设置 → 扩展 的配置表单 */
  settingsFields?: SettingFieldDef[];
  /** 注册到 资料编辑 / 主页「关于」 的自定义资料字段 */
  profileFields?: ProfileFieldDef[];
}

/** 按声明逐字段收敛 + 校验扩展设置（丢弃未声明键，服务端/客户端共用）。 */
export function coerceExtSettings(
  manifest: ExtensionManifest,
  input: unknown,
): Record<string, unknown> {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of manifest.settingsFields ?? []) {
    const raw = src[field.key];
    switch (field.type) {
      case "boolean":
        out[field.key] = typeof raw === "boolean" ? raw : (field.default ?? false);
        break;
      case "number": {
        const n = Number(raw);
        out[field.key] = Number.isFinite(n) ? n : (field.default ?? 0);
        break;
      }
      case "select":
      case "radio": {
        const value = String(raw ?? "");
        const hit = field.options?.some((o) => o.value === value);
        out[field.key] = hit ? value : (field.options?.[0]?.value ?? field.default ?? "");
        break;
      }
      default: {
        const text = typeof raw === "string" ? raw.trim() : "";
        const capped = field.maxLength ? text.slice(0, field.maxLength) : text;
        out[field.key] = capped || (typeof field.default === "string" ? field.default : "");
        break;
      }
    }
  }
  return out;
}

/** 按声明收敛用户自定义资料字段（保留声明过的键，超长截断）。 */
export function coerceProfileFields(
  defs: ProfileFieldDef[],
  input: unknown,
): Record<string, string> {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const def of defs) {
    const raw = typeof src[def.key] === "string" ? (src[def.key] as string).trim() : "";
    if (!raw) continue;
    out[def.key] = def.maxLength ? raw.slice(0, def.maxLength) : raw;
  }
  return out;
}
