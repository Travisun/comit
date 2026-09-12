import type { ReactNode } from "react";

/** Shared centered card shell for all /auth pages (single column, max-w-md). */
export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-lg bg-[var(--muted)] p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-col gap-4">{children}</div>
        {footer ? (
          <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Inline status banner used across auth forms. */
export function AuthBanner({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const cls =
    tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tone === "error"
        ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
        : "border-border bg-muted text-muted-foreground";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
