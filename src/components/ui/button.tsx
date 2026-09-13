import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * comit.sh button — Stripe (Sail) button system:
 * - primary: sail blue-500 fill + 1px keyline ring + layered drop shadow;
 *   hover keeps the fill and lifts the shadow (Stripe behavior).
 * - outline/secondary: white fill + keyline ring + whisper shadow.
 * - focus: cyan halo (sail focus shadow).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[box-shadow,background-color,color] outline-none focus-visible:shadow-[0_0_0_4px_var(--ring),0_0_1px_1px_rgba(7,89,150,0.36)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground/[0.9] shadow-[0_0_0_1px_var(--primary),0_2px_1px_rgba(47,61,137,0.15),0_2px_5px_rgba(42,47,69,0.1),0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_0_0_1px_var(--primary),0_2px_5px_rgba(42,47,69,0.3),0_4px_9px_rgba(42,47,69,0.1),0_1px_2px_rgba(0,0,0,0.08)] disabled:bg-[#7e82d9] disabled:shadow-[0_0_0_1px_#7e82d9]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_0_0_1px_var(--destructive),0_2px_1px_rgba(128,20,63,0.15),0_2px_5px_rgba(42,47,69,0.1),0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_0_0_1px_var(--destructive),0_2px_5px_rgba(42,47,69,0.3),0_4px_9px_rgba(42,47,69,0.1),0_1px_2px_rgba(0,0,0,0.08)]",
        outline:
          "bg-card text-[color:var(--text-body)] shadow-[0_0_0_1px_rgba(42,47,69,0.1),0_2px_5px_rgba(42,47,69,0.08),0_1px_1.5px_rgba(0,0,0,0.07),0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_0_0_1px_rgba(42,47,69,0.1),0_2px_5px_rgba(42,47,69,0.1),0_3px_9px_rgba(42,47,69,0.08),0_1px_1.5px_rgba(0,0,0,0.07),0_1px_2px_rgba(0,0,0,0.08)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[var(--hover)]",
        ghost: "hover:bg-[var(--hover)] hover:text-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[30px] px-2.5",
        sm: "h-7 px-2 text-[13px]",
        lg: "h-9 px-4",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
