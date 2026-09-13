import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * comit.sh inputs — Stripe (Sail) fields, per source CSS:
 * white surface, translucent keyline ring `0 0 0 1px rgba(42,47,69,.16)`
 * (no solid border), ~30px height, 4px radius.
 * Focus = double cyan ring `0 0 0 1px rgba(6,122,184,.2), 0 0 0 2px rgba(6,122,184,.25)`.
 * Placeholder = sail gray-400 #8792a2.
 */
const fieldBase =
  "w-full rounded-md border-0 bg-card text-sm text-[color:var(--text-body)] placeholder:text-[#8792a2] dark:placeholder:text-[#7c869c] transition-[box-shadow] outline-none";
const fieldRest =
  "shadow-[0_0_0_1px_var(--field-line),0_1px_1px_rgba(0,0,0,0.08)] focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b),0_1px_1px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed disabled:opacity-50";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(fieldBase, "h-[30px] px-2", fieldRest, className)}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldBase, "min-h-16 px-2 py-1", fieldRest, className)}
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
