"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Client-side enhancement for rendered markdown, scoped to the `.article-prose`
 * element rendered immediately before (or containing) this anchor:
 *  1. Mermaid — `.mermaid-block[data-diagram]` (base64 source from the server
 *     pipeline) → render SVG in the browser; friendly error on failure.
 *  2. External links — `a[data-external]` gets a leave-site confirmation
 *     dialog instead of navigating directly.
 *  3. Copy buttons — appended to every `pre` code block.
 *
 * Pass `scanKey` (e.g. the html string) to re-scan when the container content
 * changes, like the editor's live preview.
 */

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function MarkdownEnhance({ scanKey }: { scanKey?: string }) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(t);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const container =
      (anchor.previousElementSibling as HTMLElement | null) ??
      (anchor.parentElement as HTMLElement | null);
    if (!container) return;

    let cancelled = false;
    const cleanups: (() => void)[] = [];

    /* ------------------------------ mermaid ------------------------------ */
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>(".mermaid-block[data-diagram]"),
    ).filter((b) => !b.dataset.rendered);
    if (blocks.length) {
      void (async () => {
        try {
          const mermaid = (await import("mermaid")).default;
          if (cancelled) return;
          mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
          for (const [i, block] of blocks.entries()) {
            if (cancelled) return;
            block.dataset.rendered = "1";
            try {
              const source = decodeBase64Utf8(block.dataset.diagram ?? "");
              const id = `mermaid-svg-${i}-${Math.random().toString(36).slice(2, 8)}`;
              const { svg } = await mermaid.render(id, source);
              block.innerHTML = svg;
            } catch (err) {
              console.error("[markdown] mermaid render failed:", err);
              block.innerHTML = "";
              const msg = document.createElement("p");
              msg.className = "mermaid-error";
              msg.textContent = "图表渲染失败 / Failed to render diagram";
              block.appendChild(msg);
            }
          }
        } catch (err) {
          console.error("[markdown] mermaid load failed:", err);
          // 加载失败（chunk 拉取/实例化出错）也给用户可见的提示，避免静默空白
          for (const block of blocks) {
            block.dataset.rendered = "1";
            block.innerHTML = "";
            const msg = document.createElement("p");
            msg.className = "mermaid-error";
            msg.textContent = "图表渲染失败 / Failed to render diagram";
            block.appendChild(msg);
          }
        }
      })();
    }

    /* -------------------------- external links --------------------------- */
    container.querySelectorAll<HTMLAnchorElement>("a[data-external]").forEach((a) => {
      if (a.dataset.enhanced) return;
      a.dataset.enhanced = "1";
      const handler = (e: MouseEvent) => {
        e.preventDefault();
        setExternalUrl(a.dataset.externalHref || a.getAttribute("href"));
      };
      a.addEventListener("click", handler);
      cleanups.push(() => a.removeEventListener("click", handler));
    });

    /* --------------------------- copy buttons ---------------------------- */
    container.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
      if (pre.querySelector(":scope > .md-copy-btn")) return;
      pre.style.position = "relative";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "md-copy-btn";
      btn.textContent = tRef.current("common.copy");
      btn.style.cssText = [
        "position:absolute",
        "top:8px",
        "right:8px",
        "padding:2px 10px",
        "font-size:12px",
        "line-height:1.6",
        "color:#e6edf3",
        "background:rgba(240,246,252,0.12)",
        "border:1px solid rgba(240,246,252,0.2)",
        "border-radius:6px",
        "cursor:pointer",
        "opacity:0",
        "transition:opacity .15s ease",
        "z-index:1",
      ].join(";");
      pre.addEventListener("mouseenter", () => (btn.style.opacity = "1"));
      pre.addEventListener("mouseleave", () => (btn.style.opacity = "0"));
      btn.addEventListener("click", () => {
        const text = (pre.querySelector("code") ?? pre).textContent ?? "";
        const done = () => {
          btn.textContent = tRef.current("common.copied");
          btn.style.opacity = "1";
          window.setTimeout(() => {
            btn.textContent = tRef.current("common.copy");
            btn.style.opacity = "0";
          }, 1500);
        };
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).then(done).catch(() => {});
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          done();
        }
      });
      pre.appendChild(btn);
      cleanups.push(() => btn.remove());
    });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [scanKey]);

  return (
    <>
      <div ref={anchorRef} aria-hidden className="hidden" />
      <Dialog open={externalUrl !== null} onOpenChange={(open) => !open && setExternalUrl(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("external.title")}</DialogTitle>
            <DialogDescription className="break-all">
              {t("external.desc", { url: externalUrl ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExternalUrl(null)}>
              {t("external.stay")}
            </Button>
            <Button
              onClick={() => {
                if (externalUrl) window.open(externalUrl, "_blank", "noopener,noreferrer");
                setExternalUrl(null);
              }}
            >
              {t("external.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
