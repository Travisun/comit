import { cn } from "@/lib/utils";

export function BrandLogo({
  size = 24,
  withWordmark = true,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  const fontSize = size * 0.7;
  return (
    <span
      className={cn("inline-flex select-none items-baseline font-mono font-extrabold tracking-[-0.04em] text-foreground", className)}
      role={withWordmark ? "img" : undefined}
      aria-label={withWordmark ? "comit.sh" : undefined}
      style={{ fontSize: `${fontSize}px`, lineHeight: 1 }}
    >
      comit<span className="text-primary">.</span>sh
    </span>
  );
}