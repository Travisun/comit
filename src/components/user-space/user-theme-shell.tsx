import type { CSSProperties, ReactNode } from "react";
import type { User } from "@/db/schema";

type Appearance = {
  homeBg?: string | null;
  postBg?: string | null;
  accent?: string | null;
  fontFamily?: string | null;
  fontSize?: "sm" | "md" | "lg" | null;
};

const FONT_SIZES: Record<"sm" | "md" | "lg", string> = {
  sm: "1rem",
  md: "1.0625rem",
  lg: "1.1875rem",
};

/** css color, `url(...)`, or a bare image path/URL → background style. */
function resolveBackground(value: string | null | undefined): CSSProperties | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^url\(/i.test(v)) {
    return { backgroundImage: v, backgroundSize: "cover", backgroundPosition: "center" };
  }
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) {
    return {
      backgroundImage: `url(${JSON.stringify(v)})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: v };
}

/**
 * Applies a user's appearance customization (background / accent color /
 * font family / prose font size) to their public pages.
 *  - scope "home": uses appearance.homeBg (profile & site-home pages)
 *  - scope "post": uses appearance.postBg (article reading page)
 */
export function UserThemeShell({
  user,
  scope,
  className,
  children,
}: {
  user: Pick<User, "id" | "appearance">;
  scope: "home" | "post";
  className?: string;
  children: ReactNode;
}) {
  const a = (user.appearance ?? {}) as Appearance;
  const bg = resolveBackground(scope === "post" ? a.postBg : a.homeBg);

  const style: Record<string, string> = {};
  if (bg) Object.assign(style, bg);
  if (a.accent) {
    style["--primary"] = a.accent;
    style["--ring"] = `color-mix(in oklab, ${a.accent} 35%, transparent)`;
  }
  if (a.fontFamily) style.fontFamily = a.fontFamily;

  const fontSize = a.fontSize && a.fontSize !== "md" ? FONT_SIZES[a.fontSize] : null;
  const shellId = `uts-${scope}-${user.id.slice(0, 8)}`;

  return (
    <div data-user-theme={shellId} style={style as CSSProperties} className={className}>
      {fontSize && (
        <style
          dangerouslySetInnerHTML={{
            __html: `[data-user-theme="${shellId}"] .article-prose { font-size: ${fontSize}; }`,
          }}
        />
      )}
      {children}
    </div>
  );
}
