"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Languages } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Button variant="ghost" size="icon" aria-hidden />;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="切换主题 / Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function LocaleToggle({ current }: { current: "zh" | "en" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  function switchTo(locale: "zh" | "en") {
    document.cookie = `mb_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
    setOpen(false);
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="语言 / Language" disabled={pending}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => switchTo("zh")} data-checked={current === "zh"}>
          简体中文 {current === "zh" && "✓"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => switchTo("en")} data-checked={current === "en"}>
          English {current === "en" && "✓"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
