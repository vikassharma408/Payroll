import Link from "next/link";
import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-lg border border-[var(--line)] bg-[var(--ink-3)] p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-serif-heading text-xl font-semibold text-[var(--ivory)]">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--ivory-dim)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  href,
  variant = "primary",
  type,
  className,
  ...rest
}: {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  className?: string;
  [key: string]: unknown;
}) {
  const cls = clsx(
    "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    variant === "primary" && "bg-[var(--gold)] text-[var(--on-accent)] hover:bg-[var(--gold-hover)]",
    variant === "secondary" && "bg-[var(--ink-2)] text-[var(--ivory)] border border-[var(--line)] hover:bg-[var(--ink-3)]",
    variant === "danger" && "bg-[var(--bad)] text-[var(--on-accent)] hover:opacity-90",
    variant === "ghost" && "text-[var(--gold)] hover:underline",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={cls} {...(rest as object)}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type ?? "button"} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  const cls = clsx(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border",
    tone === "default" && "bg-[var(--ink-2)] text-[var(--ivory-dim)] border-[var(--line)]",
    tone === "success" && "bg-[color-mix(in_srgb,var(--good)_18%,transparent)] text-[var(--good)] border-transparent",
    tone === "warning" && "bg-[color-mix(in_srgb,var(--clay)_20%,transparent)] text-[var(--clay)] border-transparent",
    tone === "danger" && "bg-[color-mix(in_srgb,var(--bad)_18%,transparent)] text-[var(--bad-text)] border-transparent",
    tone === "info" && "bg-[color-mix(in_srgb,var(--teal)_18%,transparent)] text-[var(--teal)] border-transparent",
  );
  return <span className={cls}>{children}</span>;
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--ivory-dim)]">{label}</span>
      <span className="text-2xl font-semibold text-[var(--ivory)]">{value}</span>
      {sub && <span className="text-xs text-[var(--ivory-dim)]">{sub}</span>}
    </Card>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("border-b border-[var(--line)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--ivory-dim)]", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("border-b border-[var(--line)] px-3 py-2 text-sm text-[var(--ivory)]", className)}>{children}</td>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ivory-dim)]">{message}</div>;
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

/** Positive/negative figures (variance, gains/losses on a comparison) - use instead of Badge tones for numeric deltas. */
export function Delta({ value, formatter = inr }: { value: number; formatter?: (n: number) => string }) {
  const cls = value > 0 ? "text-[var(--good)]" : value < 0 ? "text-[var(--bad-text)]" : "text-[var(--ivory-dim)]";
  const sign = value > 0 ? "+" : "";
  return <span className={cls}>{sign}{formatter(value)}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-[var(--ivory)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--ivory-dim)]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "rounded-md border border-[var(--line)] bg-[var(--ink-2)] px-2.5 py-1.5 text-sm text-[var(--ivory)] placeholder:text-[var(--ivory-dim)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]";
