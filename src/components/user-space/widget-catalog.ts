/**
 * Sidebar widget catalog. Consumed by the settings UI (agent D) and by
 * `UserSidebar` to resolve a user's `widgets` selection into components.
 */
export interface WidgetDef {
  id: string;
  label: { zh: string; en: string };
  default: boolean;
}

export const WIDGET_CATALOG: WidgetDef[] = [
  { id: "profile-card", label: { zh: "资料卡片", en: "Profile card" }, default: true },
  { id: "archives", label: { zh: "文章归档", en: "Archives" }, default: true },
  { id: "hot-posts", label: { zh: "热门文章", en: "Hot posts" }, default: true },
  { id: "topic-cloud", label: { zh: "话题云", en: "Topic cloud" }, default: true },
];

/** Default widget order (catalog entries flagged `default`, catalog order). */
export const DEFAULT_WIDGETS: string[] = WIDGET_CATALOG.filter((w) => w.default).map((w) => w.id);
