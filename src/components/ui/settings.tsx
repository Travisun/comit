import * as React from "react";
import { Checkbox as UiCheckbox } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/*
 * Settings building blocks — abstracted from the Stripe dashboard settings
 * pages. Composition follows Stripe's light style:
 *
 *   - Section headers (title + description) sit NAKED on the white page.
 *   - Form fields sit NAKED on the page — no surrounding card.
 *   - Only data lists / tables get a keyline box (see ui/table.tsx).
 *   - Sections are separated by whitespace; the save action is a plain
 *     primary button at the bottom-left of the section, no divider bar.
 *
 *   <SettingsSection>
 *     <SettingsSectionHeader title="…" description="…" />
 *     <SettingField …>…        (naked fields)
 *     <SettingsFooter hint="…"><Button>保存</Button></SettingsFooter>
 *   </SettingsSection>
 *
 * Property / toggle rows use hairline separators (divide-y) instead of boxes.
 * All colors via theme tokens.
 */

/* ------------------------------ section ------------------------------ */

function SettingsSection({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return <section className={cn("space-y-4", className)} {...props} />;
}

function SettingsSectionHeader({
  title,
  count,
  description,
  action,
  className,
}: {
  /** Optional under tabs — the tab label already names the section. */
  title?: React.ReactNode;
  /** Optional count chip rendered after the title ("Linked bank accounts (3)"). */
  count?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header action (e.g. an outline button / Manage link). */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        {title ? (
          <h3 className="flex items-center gap-2 text-base font-semibold leading-6 text-foreground">
            {title}
            {count != null && count !== 0 ? (
              <span className="rounded-full bg-[var(--selected)] px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </h3>
        ) : null}
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground [&_a]:text-link [&_a]:underline-offset-2 hover:[&_a]:underline">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------- form field rows -------------------------- */

/** Label above a control, hint below — the Stripe form field pattern. */
function SettingField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground select-none">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Toggle row — label + description on the left, control on the right.
 * Wrap a list of rows in `divide-y divide-border` (hairline separators,
 * no boxes).
 */
function SettingRow({
  label,
  description,
  control,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg px-3 -mx-2 py-3.5 transition-colors first:pt-0 hover:bg-[var(--hover,#f7f8f8)] sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/**
 * Property row — a read-only "label: value" pair with actions on the right
 * (Stripe property lists, e.g. bank account rows with an Edit button).
 */
function PropertyRow({
  label,
  value,
  action,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 py-3.5 first:pt-0 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-sm text-[color:var(--text-body)]">{value}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --------------------------- section tabs ---------------------------- */

/**
 * Stripe settings sub-section tabs: a muted track with the active segment
 * raised as a white pill (radio-tablist pattern from the settings pages).
 * Client components drive `value`/`onChange` to swap the visible section.
 */
function SectionTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: string; label: React.ReactNode }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-6 border-b border-border", className)}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-[3px] px-0.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ footer ------------------------------- */

/**
 * Save action — a plain primary button at the bottom-left of the section
 * (Stripe page forms), with an optional muted hint beside it. No divider bar.
 */
function SettingsFooter({
  hint,
  children,
  className,
}: {
  hint?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 pt-1", className)}>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ---------------------------- option cards ---------------------------- */

/**
 * Single-select option row (Stripe radio cards): title + optional badge
 * ("Recommended") + description below. Group a list inside
 * `role="radiogroup"` — options get rounded hover washes.
 */
function RadioOption({
  title,
  badge,
  description,
  checked,
  onSelect,
  name,
  className,
}: {
  title: React.ReactNode;
  /** Small chip next to the title, e.g. "推荐". */
  badge?: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onSelect: () => void;
  /** radiogroup name for a11y. */
  name: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg px-3 -mx-3 py-3.5 transition-colors hover:bg-[var(--hover,#f7f8f8)] first:pt-0",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 appearance-none rounded-full border border-[var(--input)] bg-card transition-colors checked:border-[5px] checked:border-primary"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Multi-select option row (Stripe checkbox cards): title + meta lines
 * ("Typically arrives in 2–3 days • May require …") + optional lock state.
 */
function CheckOption({
  title,
  description,
  meta,
  checked,
  onToggle,
  disabled = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Meta line(s) rendered as "• x" bullets under the title. */
  meta?: React.ReactNode[];
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg px-3 -mx-3 py-3.5 transition-colors first:pt-0 hover:bg-[var(--hover,#f7f8f8)]",
        disabled ? "cursor-default" : "cursor-pointer",
        className,
      )}
    >
      <UiCheckbox checked={checked} onCheckedChange={(v: boolean | "indeterminate") => onToggle(v === true)} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
        ) : null}
        {meta && meta.length > 0 ? (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {meta.filter(Boolean).map((m, i) => (
              <span key={i} className="mr-2 inline-flex items-center gap-1.5">
                {i > 0 || description ? <span aria-hidden>•</span> : null}
                {m}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/* ------------------------------ notice ------------------------------- */

/** Tinted notice box (Stripe Notice): success / warning / info / danger. */
const NOTICE_TONES = {
  info: "border-border bg-[var(--muted)] text-[color:var(--text-body)]",
  success:
    "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] text-[var(--success)]",
  warning:
    "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] text-[var(--warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] text-[var(--destructive)]",
} as const;

function Notice({
  tone = "info",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: keyof typeof NOTICE_TONES }) {
  return (
    <div
      role="note"
      className={cn("flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm leading-6", NOTICE_TONES[tone], className)}
      {...props}
    />
  );
}

export {
  SettingsSection,
  SettingsSectionHeader,
  SectionTabs,
  RadioOption,
  CheckOption,
  SettingField,
  SettingRow,
  PropertyRow,
  SettingsFooter,
  Notice,
};
