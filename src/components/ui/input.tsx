import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * comit.sh inputs — Stripe style: 36px height, 6px radius,
 * border on muted surface (#f4f7fa), NO shadow.
 * Focus = primary border + soft primary ring (25%).
 */
const fieldFocus =
  "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-[var(--muted)] px-3 py-1 text-sm transition-colors",
        "placeholder:text-muted-foreground",
        fieldFocus,
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-[var(--muted)] px-3 py-2 text-sm transition-colors",
        "placeholder:text-muted-foreground",
        fieldFocus,
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm font-medium leading-none select-none", className)}
      {...props}
    />
  );
}

export { Input, Textarea, Label };
