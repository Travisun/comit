import { cn } from "@/lib/utils";

/**
 * Brand logo. withWordmark (default) renders the "comit.sh" text wordmark;
 * withWordmark=false renders the compact "c." tile mark used next to a
 * separate site-name label.
 */
export function BrandLogo({
  size = 24,
  withWordmark = true,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  if (!withWordmark) {
    // compact wordmark — no graphical logo, refined type only
    return (
      <span
        role="img"
        aria-label="comit.sh"
        className={cn(
          "inline-flex select-none items-baseline font-mono text-foreground",
          "font-extrabold tracking-[-0.045em]",
          className,
        )}
        style={{ fontSize: Math.max(size * 0.72, 15), lineHeight: 1 }}
      >
        comit<span className="text-muted-foreground/70">.</span>sh
      </span>
    );
  }
  const fontSize = size * 0.7;
  return (
    <span
      className={cn("inline-flex select-none items-baseline font-mono font-extrabold tracking-[-0.045em] text-foreground", className)}
      role="img"
      aria-label="comit.sh"
      style={{ fontSize: `${fontSize}px`, lineHeight: 1 }}
    >
      comit<span className="text-muted-foreground/70">.</span>sh
    </span>
  );
}
