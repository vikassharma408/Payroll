"use client";

import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface TrendPoint {
  month: string;
  gross: number;
  net: number;
  tds: number;
  pf: number;
  employees: number;
}

const COLORS = { gross: "#1d4ed8", net: "#15803d", tds: "#b45309", pf: "#7c3aed", employees: "#0891b2" };

export function PayrollTrendCharts({ data }: { data: TrendPoint[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="h-72 rounded-lg border border-[var(--border)] bg-white p-4">
        <div className="mb-2 text-sm font-semibold">Gross vs Net Payroll</div>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => `Rs ${Number(v).toLocaleString("en-IN")}`} />
            <Legend />
            <Line type="monotone" dataKey="gross" stroke={COLORS.gross} name="Gross" strokeWidth={2} />
            <Line type="monotone" dataKey="net" stroke={COLORS.net} name="Net" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="h-72 rounded-lg border border-[var(--border)] bg-white p-4">
        <div className="mb-2 text-sm font-semibold">TDS &amp; PF</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => `Rs ${Number(v).toLocaleString("en-IN")}`} />
            <Legend />
            <Bar dataKey="tds" fill={COLORS.tds} name="TDS" />
            <Bar dataKey="pf" fill={COLORS.pf} name="PF (Employee+Employer)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-64 rounded-lg border border-[var(--border)] bg-white p-4 lg:col-span-2">
        <div className="mb-2 text-sm font-semibold">Employee Count Processed</div>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="employees" fill={COLORS.employees} name="Employees" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
