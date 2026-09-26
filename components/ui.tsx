import Link from "next/link";
import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-[var(--foreground)]">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}
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
    variant === "primary" && "bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]",
    variant === "secondary" && "bg-white text-[var(--foreground)] border border-[var(--border)] hover:bg-gray-50",
    variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
    variant === "ghost" && "text-[var(--brand)] hover:underline",
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
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
    tone === "default" && "bg-gray-100 text-gray-700",
    tone === "success" && "bg-green-100 text-green-800",
    tone === "warning" && "bg-amber-100 text-amber-800",
    tone === "danger" && "bg-red-100 text-red-800",
    tone === "info" && "bg-blue-100 text-blue-800",
  );
  return <span className={cls}>{children}</span>;
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
    </Card>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("border-b border-[var(--border)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("border-b border-[var(--border)] px-3 py-2 text-sm", className)}>{children}</td>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">{message}</div>;
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "rounded-md border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]";
