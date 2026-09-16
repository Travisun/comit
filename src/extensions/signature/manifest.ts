import type { ExtensionManifest } from "@/core/capabilities/manifest";

/**
 * 签名档扩展 — 全能力面示范：
 * 文章渲染管线（前/后输出 + 登录可见打断）· 用户级扩展设置（自动表单）·
 * 自定义资料字段 · 扩展 API 路由 · 独立页面（bare 布局）· rail widget ·
 * 左侧导航 / 用户菜单注入。
 */
const manifest = {
  id: "signature",
  title: { zh: "签名档", en: "Signature" },
  description: {
    zh: "在你的文章正文前后附加个性签名；可开启「仅登录可见」。所有数据存于扩展自身命名空间。",
    en: "Attach a personal signature around your article body; optional sign-in-only gating.",
  },
  version: "1.0.0",
  settingsFields: [
    {
      key: "enabled",
      type: "boolean",
      label: "启用签名档",
      default: false,
    },
    {
      key: "content",
      type: "textarea",
      label: "签名内容",
      placeholder: "—— 由 comit.sh 强力驱动",
      maxLength: 200,
      description: "支持纯文本；将转义后插入正文。",
    },
    {
      key: "placement",
      type: "select",
      label: "插入位置",
      default: "append",
      options: [
        { value: "append", label: "正文之后" },
        { value: "prepend", label: "正文之前" },
      ],
    },
    {
      key: "loginRequired",
      type: "boolean",
      label: "仅登录可见正文",
      description: "未登录访客将看到登录引导卡片（渲染打断演示）。",
      default: false,
    },
  ],
  profileFields: [
    {
      key: "ext.signature.tagline",
      type: "text",
      label: "一句话签名",
      placeholder: "出现在主页「关于」中",
      maxLength: 80,
    },
  ],
} satisfies ExtensionManifest;

export default manifest;
