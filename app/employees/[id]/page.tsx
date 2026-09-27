import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, Button, Badge, Th, Td, inr, EmptyState } from "@/components/ui";
import { SalaryStructureForm } from "@/components/salary-structure-form";
import { InvestmentDeclarationForm } from "@/components/investment-declaration-form";
import { PreviousEmployerSection } from "@/components/previous-employer-form";
import { DeleteEmployeeButton } from "@/components/delete-employee-button";
import { RegimeEstimateCard } from "@/components/regime-estimate";
import { estimateRegimeComparison } from "@/lib/payroll/estimate";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fy?: string }>;
}) {
  const { id } = await params;
  const { fy: fyCode } = await searchParams;

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  const financialYears = await prisma.financialYear.findMany({ orderBy: { startDate: "asc" } });
  const activeFy = (fyCode ? financialYears.find((f) => f.code === fyCode) : financialYears.find((f) => f.isCurrent)) ?? financialYears[financialYears.length - 1];

  const components = await prisma.salaryComponent.findMany({ orderBy: { order: "asc" } });
  const structure = activeFy
    ? await prisma.employeeSalaryStructure.findFirst({
        where: { employeeId: id, financialYearId: activeFy.id, isActive: true },
        include: { components: { include: { component: true } } },
      })
    : null;
  const existingComponents: Record<string, { formula?: string; annualAmount: number }> = {};
  for (const c of structure?.components ?? []) {
    existingComponents[c.component.code] = { formula: c.formulaUsed ?? undefined, annualAmount: c.annualAmount };
  }

  const declaration = activeFy
    ? await prisma.investmentDeclaration.findUnique({ where: { employeeId_financialYearId: { employeeId: id, financialYearId: activeFy.id } } })
    : null;

  const previousEmployerRows = activeFy
    ? await prisma.previousEmployerIncome.findMany({ where: { employeeId: id, financialYearId: activeFy.id }, orderBy: { periodFrom: "asc" } })
    : [];

  const regimeEstimate = activeFy ? await estimateRegimeComparison(id, activeFy.id) : null;

  const payrollLines = await prisma.payrollRunLine.findMany({
    where: { employeeId: id },
    include: { payrollRun: { include: { financialYear: true } } },
    orderBy: [{ payrollRun: { financialYearId: "desc" } }, { payrollRun: { payrollMonthIndex: "asc" } }],
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={employee.fullName}
        description={`${employee.employeeCode} · ${employee.designation ?? "-"} · ${employee.department ?? "-"}`}
        actions={
          <>
            <Badge tone={employee.status === "ACTIVE" ? "success" : "default"}>{employee.status}</Badge>
            <Button href={`/employees/${id}/edit`} variant="secondary">Edit Profile</Button>
            <DeleteEmployeeButton employeeId={id} employeeName={employee.fullName} />
          </>
        }
      />

      {financialYears.length === 0 ? (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--clay)_45%,transparent)] bg-[color-mix(in_srgb,var(--clay)_12%,transparent)] px-4 py-3 text-sm text-[var(--clay)]">
          <strong>No Financial Year is configured yet</strong> — that&apos;s why Salary Structure, Investment
          Declaration and Previous Employer don&apos;t appear below (they each need a Financial Year to attach to).
          Run <code className="rounded bg-[color-mix(in_srgb,var(--clay)_22%,transparent)] px-1 py-0.5 font-mono">npm run db:seed</code> from the
          project folder to set up financial years, tax rules and master data, then refresh this page.
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap gap-2">
            {financialYears.map((f) => (
              <Link
                key={f.id}
                href={`/employees/${id}?fy=${f.code}`}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${f.id === activeFy?.id ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)] text-[var(--brand)]" : "border-[var(--border)] bg-[var(--ink-2)]"}`}
              >
                FY {f.code}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-3 text-sm font-semibold">Profile</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-4">
          <div><span className="text-[var(--muted)]">PAN:</span> {employee.pan ?? "-"}</div>
          <div><span className="text-[var(--muted)]">DOB:</span> {employee.dob?.toISOString().slice(0, 10) ?? "-"}</div>
          <div><span className="text-[var(--muted)]">Date of Joining:</span> {employee.dateOfJoining.toISOString().slice(0, 10)}</div>
          <div><span className="text-[var(--muted)]">Date of Leaving:</span> {employee.dateOfLeaving?.toISOString().slice(0, 10) ?? "-"}</div>
          <div><span className="text-[var(--muted)]">UAN:</span> {employee.uan ?? "-"}</div>
          <div><span className="text-[var(--muted)]">Location:</span> {employee.location ?? "-"}</div>
          <div><span className="text-[var(--muted)]">Tax Regime:</span> <Badge tone="info">{employee.taxRegime}</Badge></div>
          <div><span className="text-[var(--muted)]">Metro City:</span> {employee.isMetroCity ? "Yes" : "No"}</div>
          <div><span className="text-[var(--muted)]">Bank:</span> {employee.bankName ?? "-"}</div>
          <div><span className="text-[var(--muted)]">Account No:</span> {employee.bankAccountNo ?? "-"}</div>
          <div><span className="text-[var(--muted)]">IFSC:</span> {employee.bankIfsc ?? "-"}</div>
          <div><span className="text-[var(--muted)]">PF / ESI / PT:</span> {employee.pfApplicable ? "PF" : ""} {employee.esiApplicable ? "ESI" : ""} {employee.ptApplicable ? "PT" : ""}</div>
        </div>
      </Card>

      {activeFy && (
        <SalaryStructureForm
          employeeId={id}
          financialYearId={activeFy.id}
          financialYearCode={activeFy.code}
          components={components.map((c) => ({ id: c.id, code: c.code, name: c.name, category: c.category as never }))}
          existing={existingComponents}
          existingCTC={structure?.annualCTC ?? 0}
        />
      )}

      {activeFy && (
        <InvestmentDeclarationForm
          employeeId={id}
          financialYearId={activeFy.id}
          financialYearCode={activeFy.code}
          declaration={declaration ?? undefined}
        />
      )}

      {activeFy && (
        <PreviousEmployerSection
          employeeId={id}
          financialYearId={activeFy.id}
          financialYearCode={activeFy.code}
          rows={previousEmployerRows}
        />
      )}

      {activeFy && <RegimeEstimateCard estimate={regimeEstimate} financialYearCode={activeFy.code} />}

      <Card>
        <div className="mb-3 text-sm font-semibold">Payroll History</div>
        {payrollLines.length === 0 ? (
          <EmptyState message="No payroll processed yet for this employee." />
        ) : (
          <table>
            <thead>
              <tr>
                <Th>FY</Th>
                <Th>Month</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>TDS</Th>
                <Th>Net</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {payrollLines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.payrollRun.financialYear.code}</Td>
                  <Td>{l.payrollRun.calendarMonth}/{l.payrollRun.calendarYear}</Td>
                  <Td>{inr(l.grossSalary)}</Td>
                  <Td>{inr(l.totalDeductions)}</Td>
                  <Td>{inr(l.tdsMonthly)}</Td>
                  <Td>{inr(l.netSalary)}</Td>
                  <Td><Badge>{l.payrollRun.status}</Badge></Td>
                  <Td>
                    <Link href={`/payroll/${l.payrollRunId}/lines/${l.id}`} className="text-[var(--brand)] hover:underline">
                      View
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
