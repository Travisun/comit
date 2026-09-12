"use client";

import type { ReactNode } from "react";
import { Switch, Separator } from "@/components/ui/primitives";
import { Label } from "@/components/ui/input";

/** Labeled switch row used on the settings page (optionally wrapped in separators). */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  last = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={label}
        />
      </div>
      {!last ? <Separator /> : null}
    </>
  );
}

/** Simple label + control field row for settings forms. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
