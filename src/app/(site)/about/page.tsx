import type { Metadata } from "next";
import Link from "next/link";
import {
  Compass,
  FileOutput,
  GitCommitHorizontal,
  GraduationCap,
  HeartHandshake,
  History,
  Home,
  Landmark,
  Microscope,
  PenTool,
  Route,
  ScrollText,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { routes } from "@/core/routes";
import { pageMetadata } from "@/lib/seo";
import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/settings";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
  title: "关于",
  description:
    "comit.sh 品牌故事：从 1956 年 MIT 的 COMIT 语言，到 git commit 的日常仪式——为什么我们相信「为每一个想法，留下主页」。",
  path: "/about",
});
}

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

/** 社区三件事 —— 呼吁每个人来这里安家、记录、看世界 */
const THINGS = [
  { icon: Home, step: "01", title: "about.things.home.title", desc: "about.things.home.desc" },
  { icon: Sparkles, step: "02", title: "about.things.daily.title", desc: "about.things.daily.desc" },
  { icon: Compass, step: "03", title: "about.things.feed.title", desc: "about.things.feed.desc" },
] as const;

const SPIRIT = [
  { icon: PenTool, line: "about.spirit.item1" },
  { icon: HeartHandshake, line: "about.spirit.item2" },
  { icon: ShieldCheck, line: "about.spirit.item3" },
] as const;

export default async function AboutPage() {
  const [{ t }, siteName] = await Promise.all([getT(), getSetting("site.name")]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 md:py-16">
      {/* ------------------------------ Hero ------------------------------ */}
      <header>
        <p className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <GitCommitHorizontal className="size-3.5 text-primary" /> {siteName}
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

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button asChild>
            <Link href={routes.register}>
              <GitCommitHorizontal className="size-4" /> {t("about.cta.register")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={routes.explore}>{t("about.cta.explore")}</Link>
          </Button>
        </div>
      </header>

      {/* ---------------------- 在这里，做三件事 ---------------------- */}
      <section className="mt-14">
        <h2 className="text-lg font-normal">{t("about.things.title")}</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {THINGS.map((x) => (
            <div
              key={x.title}
              className="flex flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-soft)]"
            >
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-xl border border-border/70 bg-[var(--muted)] text-primary">
                  <x.icon className="size-4" />
                </span>
                <span className="font-mono text-xs text-muted-foreground/60">{x.step}</span>
              </div>
              <h3 className="mt-3 font-normal">{t(x.title)}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t(x.desc)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------- 为什么叫 comit --------------------------- */}
      <section className="mt-14">
        <h2 className="text-lg font-normal">{t("about.origins.title")}</h2>
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
                <h3 className="mt-1 font-normal">{t(o.title)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(o.body)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ 为谁而建 ------------------------------ */}
      <section className="mt-14">
        <h2 className="text-lg font-normal">{t("about.audience.title")}</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {AUDIENCE.map((a) => (
            <div key={a.name} className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-soft)]">
              <div className="flex items-center gap-2">
                <a.icon className="size-4 text-primary" />
                <h3 className="font-normal">{t(a.name)}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(a.line)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ 平台承诺 ------------------------------ */}
      <section className="mt-14">
        <h2 className="text-lg font-normal">{t("about.promise.title")}</h2>
        <ul className="mt-5 space-y-4">
          {PROMISES.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <p.icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <h3 className="text-sm font-normal">{t(p.title)}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t(p.desc)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------- 社区精神 ---------------------------- */}
      <section className="mt-14">
        <h2 className="text-lg font-normal">{t("about.spirit.title")}</h2>
        <ul className="mt-5 space-y-3.5">
          {SPIRIT.map((x) => (
            <li key={x.line} className="flex items-center gap-3 text-sm text-muted-foreground">
              <x.icon className="size-4 shrink-0 text-primary" aria-hidden />
              {t(x.line)}
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------- CTA -------------------------------- */}
      <section className="mt-16 border-t border-border/60 pt-10 text-center">
        <h2 className="text-balance text-xl font-normal">{t("about.cta.title")}</h2>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{t("brand.commit.mantra")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Button asChild>
            <Link href={routes.register}>
              <GitCommitHorizontal className="size-4" /> {t("about.cta.register")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={routes.explore}>{t("about.cta.explore")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={routes.legal.terms}>{t("about.cta.terms")}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
