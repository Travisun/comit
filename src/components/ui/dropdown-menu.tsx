"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

/* Stripe (bs-Menu) dropdown: white surface + sail large shadow, groups
   separated by gray-100 hairlines, 11px uppercase gray labels, cyan items
   that darken on a gray-50 hover. */

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-[var(--shadow-overlay),0_0_0_1px_rgba(42,47,69,0.08)]",
          "data-[state=open]:animate-[pop-in_0.18s_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-[4px] px-3 py-[5px] text-sm font-medium outline-none transition-colors",
        "text-[#067ab8] data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-[#2a2f45] dark:text-[#58b7e3] dark:data-[highlighted]:text-[#e3e8ef]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#a3acb9] dark:text-[#6b7488]", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
};
