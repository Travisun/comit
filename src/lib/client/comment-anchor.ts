/**
 * 抗 DOM-clobbering 的锚点查找工具（client-only）。
 *
 * 背景：`document.getElementById("comment-<id>")` 是全局 id 查找 —— 页面上
 * 任何早于目标出现、id 被攻击者控制的元素都会劫持它（getElementById 返回
 * 文档序首个命中）。评论楼层锚点因此改为「data-comment-id 属性 + 转义后的
 * attribute selector + 容器限定」：
 *  - data-comment-id 只由 React 以服务端 UUID 渲染，markdown sanitize 不放
 *    行任意 data-* 属性，用户内容无法伪造；
 *  - 属性值经 {@link cssAttrValue} 转义，杜绝选择器注入；
 *  - 可传入容器（如评论区 <section>），进一步把命中范围钉死在本组件内。
 */

/** 转义 CSS attribute-selector 引号串中的特殊字符（`\` 与 `"`） */
export function cssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 楼层锚点属性的选择器片段：[data-comment-id="<escaped>"] */
export function commentAnchorSelector(id: string): string {
  return `[data-comment-id="${cssAttrValue(id)}"]`;
}

/**
 * 在 root（默认 document）内查找评论楼层元素。
 * 用 attribute selector 而非 getElementById —— 不依赖全局 id 注册表。
 */
export function findCommentEl(id: string, root?: ParentNode | null): HTMLElement | null {
  const scope = root ?? (typeof document !== "undefined" ? document : null);
  if (!scope) return null;
  try {
    return scope.querySelector<HTMLElement>(commentAnchorSelector(id));
  } catch {
    // 极端畸形 id 使选择器非法（happy-dom 等实现的严格解析）：视为未命中，
    // 绝不让定位逻辑抛错
    return null;
  }
}
