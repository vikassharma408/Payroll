"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface TrendPoint {
  month: string;
  gross: number;
  net: number;
  tds: number;
  pf: number;
  employees: number;
}

const VAR_NAMES = ["--alt", "--good", "--clay", "--multi", "--teal", "--line", "--ivory-dim", "--ink-3"] as const;
type VarName = (typeof VAR_NAMES)[number];

/** SVG presentation attributes (recharts' stroke/fill props) don't reliably resolve var(...), so read the actual computed colors and re-read whenever the theme toggles. */
function useThemeColors(): Record<VarName, string> {
  const [colors, setColors] = useState<Record<VarName, string>>(
    Object.fromEntries(VAR_NAMES.map((n) => [n, "#888888"])) as Record<VarName, string>,
  );

  useEffect(() => {
    function read() {
      const styles = getComputedStyle(document.documentElement);
      setColors(Object.fromEntries(VAR_NAMES.map((n) => [n, styles.getPropertyValue(n).trim() || "#888888"])) as Record<VarName, string>);
    }
    read();
    window.addEventListener("theme-change", read);
    return () => window.removeEventListener("theme-change", read);
  }, []);

  return colors;
}

export function PayrollTrendCharts({ data }: { data: TrendPoint[] }) {
  const c = useThemeColors();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="h-72 rounded-lg border border-[var(--line)] bg-[var(--ink-3)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--ivory)]">Gross vs Net Payroll</div>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={c["--line"]} />
            <XAxis dataKey="month" fontSize={11} stroke={c["--ivory-dim"]} />
            <YAxis fontSize={11} stroke={c["--ivory-dim"]} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v) => `Rs ${Number(v).toLocaleString("en-IN")}`}
              contentStyle={{ background: c["--ink-3"], border: `1px solid ${c["--line"]}`, color: "inherit" }}
            />
            <Legend />
            <Line type="monotone" dataKey="gross" stroke={c["--alt"]} name="Gross" strokeWidth={2} />
            <Line type="monotone" dataKey="net" stroke={c["--good"]} name="Net" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="h-72 rounded-lg border border-[var(--line)] bg-[var(--ink-3)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--ivory)]">TDS &amp; PF</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={c["--line"]} />
            <XAxis dataKey="month" fontSize={11} stroke={c["--ivory-dim"]} />
            <YAxis fontSize={11} stroke={c["--ivory-dim"]} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v) => `Rs ${Number(v).toLocaleString("en-IN")}`}
              contentStyle={{ background: c["--ink-3"], border: `1px solid ${c["--line"]}`, color: "inherit" }}
            />
            <Legend />
            <Bar dataKey="tds" fill={c["--clay"]} name="TDS" />
            <Bar dataKey="pf" fill={c["--multi"]} name="PF (Employee+Employer)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-64 rounded-lg border border-[var(--line)] bg-[var(--ink-3)] p-4 lg:col-span-2">
        <div className="mb-2 text-sm font-semibold text-[var(--ivory)]">Employee Count Processed</div>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={c["--line"]} />
            <XAxis dataKey="month" fontSize={11} stroke={c["--ivory-dim"]} />
            <YAxis fontSize={11} stroke={c["--ivory-dim"]} allowDecimals={false} />
            <Tooltip contentStyle={{ background: c["--ink-3"], border: `1px solid ${c["--line"]}`, color: "inherit" }} />
            <Bar dataKey="employees" fill={c["--teal"]} name="Employees" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
