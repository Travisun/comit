import type { Metadata } from "next";
import Link from "next/link";
import {
  FileOutput,
  GitCommitHorizontal,
  GraduationCap,
  History,
  Landmark,
  Microscope,
  PenTool,
  Route,
  ScrollText,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { routes } from "@/core/routes";
import { pageMetadata } from "@/lib/seo";
import { getT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = pageMetadata({
  title: "关于",
  description:
    "comit.sh 品牌故事：从 1956 年 MIT 的 COMIT 语言，到 git commit 的日常仪式——为什么我们相信「为每一次提交，留下主页」。",
  path: "/about",
});

/**
 * /about — 品牌故事页。X 式单列排版（max-w-2xl），
 * 文案全部取自 dict（about.* / brand.* 命名空间），中英随站点语言切换。
 */

const ORIGINS = [
  { icon: Landmark, tag: "about.origin.comit.tag", title: "about.origin.comit.title", body: "about.origin.comit.body" },
  { icon: GitCommitHorizontal, tag: "about.origin.git.tag", title: "about.origin.git.title", body: "about.origin.git.body" },
  { icon: Route, tag: "about.origin.network.tag", title: "about.origin.network.title", body: "about.origin.network.body" },
  { icon: Server, tag: "about.origin.datacom.tag", title: "about.origin.datacom.title", body: "about.origin.datacom.body" },
] as const;

const AUDIENCE = [
  { icon: Terminal, name: "about.audience.hackers.name", line: "about.audience.hackers.line" },
  { icon: PenTool, name: "about.audience.designers.name", line: "about.audience.designers.line" },
  { icon: Microscope, name: "about.audience.scientists.name", line: "about.audience.scientists.line" },
  { icon: GraduationCap, name: "about.audience.students.name", line: "about.audience.students.line" },
] as const;

const PROMISES = [
  { icon: ScrollText, title: "about.promise.ownership.title", desc: "about.promise.ownership.desc" },
  { icon: History, title: "about.promise.timeline.title", desc: "about.promise.timeline.desc" },
  { icon: FileOutput, title: "about.promise.export.title", desc: "about.promise.export.desc" },
  { icon: ShieldCheck, title: "about.promise.security.title", desc: "about.promise.security.desc" },
] as const;

export default async function AboutPage() {
  const { t } = await getT();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 md:py-16">
      {/* ------------------------------ Hero ------------------------------ */}
      <header>
        <p className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <GitCommitHorizontal className="size-3.5 text-primary" /> comit.sh
        </p>
        <h1 className="mt-4 text-balance text-3xl font-black leading-tight tracking-tight md:text-4xl">
          {t("about.hero.title")}
        </h1>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{t("about.hero.subtitle")}</p>

        {/* 语源三行 —— 以提交日志的形态呈现 */}
        <div className="mt-8 rounded-2xl border border-border/70 bg-card p-5 shadow-[var(--shadow-soft)]">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">git log --comit</p>
          <div className="mt-3 space-y-1.5 font-mono text-sm leading-relaxed">
            <p className="text-muted-foreground">
              <span className="mr-2 text-primary/50">*</span>
              {t("brand.commit.line1")}
            </p>
            <p className="text-muted-foreground">
              <span className="mr-2 text-primary/50">*</span>
              {t("brand.commit.line2")}
            </p>
            <p className="font-medium">
              <span className="mr-2 text-primary">*</span>
              {t("brand.commit.line3")}
            </p>
          </div>
        </div>
      </header>

      {/* --------------------------- 为什么叫 comit --------------------------- */}
      <section className="mt-14">
        <h2 className="text-lg font-bold tracking-tight">{t("about.origins.title")}</h2>
        <div className="mt-5 space-y-7">
          {ORIGINS.map((o) => (
            <div key={o.title} className="flex gap-4">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-card text-primary">
                <o.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground/80">
                  {t(o.tag)}
                </p>
                <h3 className="mt-1 font-semibold">{t(o.title)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(o.body)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ 为谁而建 ------------------------------ */}
      <section className="mt-14">
        <h2 className="text-lg font-bold tracking-tight">{t("about.audience.title")}</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {AUDIENCE.map((a) => (
            <div key={a.name} className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-soft)]">
              <div className="flex items-center gap-2">
                <a.icon className="size-4 text-primary" />
                <h3 className="font-semibold">{t(a.name)}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(a.line)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ 平台承诺 ------------------------------ */}
      <section className="mt-14">
        <h2 className="text-lg font-bold tracking-tight">{t("about.promise.title")}</h2>
        <ul className="mt-5 space-y-4">
          {PROMISES.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <p.icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t(p.title)}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t(p.desc)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------- CTA -------------------------------- */}
      <section className="mt-16 border-t border-border/60 pt-10 text-center">
        <h2 className="text-balance text-xl font-bold tracking-tight">{t("about.cta.title")}</h2>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{t("brand.commit.mantra")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Button asChild>
            <Link href={routes.register}>
              <GitCommitHorizontal className="size-4" /> {t("about.cta.register")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={routes.legal.terms}>{t("about.cta.terms")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
