import Link from "next/link";

const NAV_GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Overview",
    links: [{ href: "/dashboard", label: "Dashboard" }],
  },
  {
    title: "Masters",
    links: [
      { href: "/employees", label: "Employees" },
      { href: "/tax-rules", label: "Tax Rules Engine" },
    ],
  },
  {
    title: "Payroll",
    links: [
      { href: "/payroll", label: "Payroll Runs" },
      { href: "/reconciliation", label: "Reconciliation" },
    ],
  },
  {
    title: "Data",
    links: [{ href: "/import", label: "Import Wizard" }],
  },
  {
    title: "Reports",
    links: [{ href: "/reports", label: "Reports" }],
  },
  {
    title: "Settings",
    links: [{ href: "/settings/company", label: "Company Settings" }],
  },
];

export function Sidebar() {
  return (
    <aside className="no-print flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] py-4">
      <div className="px-5 pb-4">
        <div className="text-lg font-bold text-[var(--brand-dark)]">PayrollIN</div>
        <div className="text-xs text-[var(--muted)]">Indian Payroll &amp; TDS</div>
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{group.title}</div>
            <div className="flex flex-col gap-0.5">
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-2 py-1.5 text-sm text-[var(--foreground)] hover:bg-gray-100"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
