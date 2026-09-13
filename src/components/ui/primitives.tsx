"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cva, type VariantProps } from "class-variance-authority";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------- Popover -------------------------------- */
/* Floating layer: 1px border + the single allowed ultra-light shadow. */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-overlay)] outline-none",
          "data-[state=open]:animate-[pop-in_0.18s_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* --------------------------------- Tabs --------------------------------- */
/* Stripe style: flat underline tabs on a hairline baseline; the active tab
   gets dark text + a 2px blurple underline. No pill fills, no borders. */
const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex items-center gap-5 border-b border-border text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-0.5 pb-2.5 pt-1 text-sm font-medium transition-colors",
        "hover:text-foreground",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}

/* -------------------------------- Switch -------------------------------- */
/* Stripe (bs-Switch) style: 46×26 gradient bevel with 1px #ced5db border and
   inset shadow; checked = blue fill, white knob. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer items-center rounded-full border px-0.5 transition-colors",
        "border-[#ced5db] bg-[linear-gradient(to_bottom,#e9ecef,#f0f3f5)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]",
        "dark:border-[#3a4258] dark:bg-[linear-gradient(to_bottom,#232937,#1c212c)]",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-none",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform data-[state=checked]:translate-x-[20px] data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

/* ------------------------------- Tooltip -------------------------------- */
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-foreground px-2.5 py-1 text-xs text-background animate-[fade-in_0.15s_ease]",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/* -------------------------------- Avatar -------------------------------- */
function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex size-9 shrink-0 overflow-hidden rounded-full border border-border bg-secondary",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn("aspect-square size-full object-cover", className)} {...props} />;
}

function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn("flex size-full items-center justify-center rounded-full bg-muted text-xs font-semibold", className)}
      {...props}
    />
  );
}

/* ------------------------------ Separator ------------------------------- */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------- Checkbox ------------------------------- */
/* Stripe style: white box + translucent keyline ring; checked = blue fill. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-4 shrink-0 rounded-[3px] bg-card transition-colors",
        "shadow-[0_0_0_1px_var(--field-line),0_1px_1px_rgba(0,0,0,0.08)]",
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-none",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)]",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* -------------------------------- Badge --------------------------------- */
/* Stripe (bs-Badge) style: 20px pill, transparent fill, inset 1px ring of
   the status color at 20% opacity, 12px/600 uppercase colored text. */
const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold uppercase leading-none transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "text-[var(--primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent)]",
        secondary:
          "text-[#697386] shadow-[inset_0_0_0_1px_color-mix(in_srgb,#697386_20%,transparent)] dark:text-[#99a2b4]",
        outline:
          "text-[#697386] shadow-[inset_0_0_0_1px_color-mix(in_srgb,#697386_20%,transparent)] dark:text-[#99a2b4]",
        success:
          "text-[var(--success)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--success)_25%,transparent)]",
        warning:
          "text-[var(--warning)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--warning)_25%,transparent)]",
        destructive:
          "text-[var(--destructive)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--destructive)_25%,transparent)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/* ------------------------------- Skeleton ------------------------------- */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Switch,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Separator,
  Checkbox,
  Badge,
  badgeVariants,
  Skeleton,
};
