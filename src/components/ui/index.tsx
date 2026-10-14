import { clsx } from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { TRUST_LABEL_AR, type TrustLabel } from "@/lib/domain/trust";

export function cn(...c: Parameters<typeof clsx>) {
  return clsx(c);
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-2 border-border",
  good: "bg-good-soft text-good border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  info: "bg-info-soft text-info border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

const TRUST_TONE: Record<TrustLabel, Tone> = { verified: "good", unverified: "warn", estimated: "info", stale: "neutral", unavailable: "bad", demo: "info" };
const TRUST_ICON: Record<TrustLabel, string> = { verified: "✓", unverified: "?", estimated: "≈", stale: "⏱", unavailable: "✕", demo: "◇" };

/** Every critical number carries one of these labels (icon + text, never color alone). */
export function TrustBadge({ label, title }: { label: TrustLabel; title?: string }) {
  return <Badge tone={TRUST_TONE[label]} title={title}><span aria-hidden>{TRUST_ICON[label]}</span>{TRUST_LABEL_AR[label]}</Badge>;
}

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "secondary" && "border border-border bg-surface hover:bg-surface-2",
        variant === "danger" && "bg-bad text-white hover:opacity-90",
        variant === "ghost" && "hover:bg-surface-2",
        className,
      )}
    />
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <a href={href} className={cn("inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
      variant === "primary" ? "bg-accent text-accent-ink hover:opacity-90" : "border border-border bg-surface hover:bg-surface-2")}>
      {children}
    </a>
  );
}

const inputCls = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm", className)}>
      <span className="font-medium text-text-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cn(inputCls, p.type === "checkbox" && "h-4 w-4", p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea {...p} className={cn(inputCls, "h-auto min-h-20 py-2", p.className)} />;
}
export function Select({ options, ...p }: ComponentProps<"select"> & { options: [string, string][] }) {
  return (
    <select {...p} className={cn(inputCls, p.className)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-right text-xs text-muted">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border/70 [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top">
          {rows.length ? children : (
            <tr><td colSpan={head.length} className="py-8 text-center text-muted">{empty ?? "لا توجد بيانات بعد"}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, sub, trust }: { label: string; value: ReactNode; sub?: ReactNode; trust?: TrustLabel }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-text-2">{label}</div>
        {trust && <TrustBadge label={trust} />}
      </div>
      <div className="num mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-2 text-sm text-text-2">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", TONES[tone])}>{children}</div>;
}

export function ExternalLink({ href, children }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href) return <span className="text-muted">—</span>;
  let host = href;
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch {}
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-info underline-offset-2 hover:underline" dir="ltr">{children ?? host}</a>;
}
