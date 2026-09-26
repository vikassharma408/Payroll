import { prisma } from "@/lib/db";
import { PageHeader, Card, Badge, Th, Td, inr, Button, Field, inputClass } from "@/components/ui";
import { updateTaxRuleSet, setCurrentFinancialYear } from "@/lib/actions/tax-rules";
import Link from "next/link";

export default async function TaxRulesPage({ searchParams }: { searchParams: Promise<{ fy?: string; regime?: string }> }) {
  const { fy: fyCode, regime } = await searchParams;
  const financialYears = await prisma.financialYear.findMany({ orderBy: { startDate: "asc" } });
  const activeFy = (fyCode ? financialYears.find((f) => f.code === fyCode) : financialYears.find((f) => f.isCurrent)) ?? financialYears[0];
  const activeRegime = regime === "OLD" ? "OLD" : "NEW";

  async function handleUpdate(ruleSetId: string, formData: FormData) {
    "use server";
    await updateTaxRuleSet(ruleSetId, formData);
  }
  async function handleSetCurrent(fyId: string) {
    "use server";
    await setCurrentFinancialYear(fyId);
  }

  const ruleSet = activeFy
    ? await prisma.taxRuleSet.findFirst({
        where: { financialYearId: activeFy.id, regime: activeRegime, isActive: true },
        orderBy: { effectiveFrom: "desc" },
        include: { slabs: { orderBy: [{ ageCategory: "asc" }, { order: "asc" }] }, rules: true },
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Tax Rules Engine" description="Config-driven tax rules by Financial Year, Regime and Effective Date - never hard-coded." />

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-1">
            {financialYears.map((f) => (
              <Link
                key={f.id}
                href={`/tax-rules?fy=${f.code}&regime=${activeRegime}`}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${f.id === activeFy?.id ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)] text-[var(--brand)]" : "border-[var(--border)] bg-[var(--ink-2)]"}`}
              >
                FY {f.code}
              </Link>
            ))}
          </div>
          <div className="flex gap-1">
            {(["OLD", "NEW"] as const).map((r) => (
              <Link
                key={r}
                href={`/tax-rules?fy=${activeFy?.code}&regime=${r}`}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${r === activeRegime ? "border-[var(--brand-dark)] bg-[var(--gold)] text-[var(--on-accent)]" : "border-[var(--border)] bg-[var(--ink-2)]"}`}
              >
                {r === "OLD" ? "Old Regime" : "New Regime"}
              </Link>
            ))}
          </div>
        </div>
      </Card>

      {!ruleSet ? (
        <Card>No tax rule set configured for this FY/regime yet.</Card>
      ) : (
        <>
          {ruleSet.notes && (
            <div className="rounded-md border border-[color-mix(in_srgb,var(--clay)_45%,transparent)] bg-[color-mix(in_srgb,var(--clay)_12%,transparent)] px-4 py-3 text-sm text-[var(--clay)]">
              <strong>Assumption / Notice:</strong> {ruleSet.notes}
            </div>
          )}

          <form action={handleUpdate.bind(null, ruleSet.id)} className="flex flex-col gap-4">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Key Parameters (effective {ruleSet.effectiveFrom.toISOString().slice(0, 10)})</div>
                {!activeFy?.isCurrent && (
                  <Button type="submit" variant="secondary" formAction={handleSetCurrent.bind(null, activeFy!.id)} formNoValidate>Set FY {activeFy?.code} as Current</Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Field label="Standard Deduction (Rs)"><input name="standardDeduction" type="number" defaultValue={ruleSet.standardDeduction} className={inputClass} /></Field>
                <Field label="Cess Rate (%)"><input name="cessRatePercent" type="number" step="0.01" defaultValue={ruleSet.cessRate * 100} className={inputClass} /></Field>
                <Field label="87A Rebate Limit - Old (Rs)"><input name="rebateLimitOld" type="number" defaultValue={ruleSet.rebateLimitOld} className={inputClass} /></Field>
                <Field label="87A Rebate Max - Old (Rs)"><input name="rebateMaxOld" type="number" defaultValue={ruleSet.rebateMaxOld} className={inputClass} /></Field>
                <Field label="87A Rebate Limit - New (Rs)"><input name="rebateLimitNew" type="number" defaultValue={ruleSet.rebateLimitNew} className={inputClass} /></Field>
                <Field label="80CCD(2) Employer NPS Cap (%)"><input name="npsEmployerCapPercentPercent" type="number" step="0.01" defaultValue={ruleSet.npsEmployerCapPercent * 100} className={inputClass} /></Field>
                <Field label="Employer PF+NPS+Super Perquisite Limit (Rs)"><input name="employerNpsPfPerqLimit" type="number" defaultValue={ruleSet.employerNpsPfPerqLimit} className={inputClass} /></Field>
              </div>
              <div className="mt-3">
                <Field label="Notes / Assumptions">
                  <textarea name="notes" defaultValue={ruleSet.notes ?? ""} className={`${inputClass} w-full`} rows={2} />
                </Field>
              </div>
            </Card>

            <Card>
              <div className="mb-3 text-sm font-semibold">Income Tax Slabs</div>
              <table>
                <thead>
                  <tr>
                    <Th>Age Category</Th>
                    <Th>From (Rs)</Th>
                    <Th>To (Rs, blank = no limit)</Th>
                    <Th>Rate (%)</Th>
                  </tr>
                </thead>
                <tbody>
                  {ruleSet.slabs.map((s) => (
                    <tr key={s.id}>
                      <Td>{s.ageCategory.replaceAll("_", " ")}</Td>
                      <Td><input name={`slab_${s.id}_min`} type="number" defaultValue={s.minIncome} className={`${inputClass} w-32`} /></Td>
                      <Td><input name={`slab_${s.id}_max`} type="number" defaultValue={s.maxIncome ?? ""} className={`${inputClass} w-32`} /></Td>
                      <Td><input name={`slab_${s.id}_rate`} type="number" step="0.01" defaultValue={s.rate * 100} className={`${inputClass} w-24`} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3">
                <Button type="submit">Save Tax Rule Changes</Button>
              </div>
            </Card>
          </form>

          <Card>
            <div className="mb-3 text-sm font-semibold">Rule Catalog</div>
            <table>
              <thead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Section</Th>
                  <Th>Calculation Method</Th>
                  <Th>Limit</Th>
                  <Th>Rate</Th>
                </tr>
              </thead>
              <tbody>
                {ruleSet.rules.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td>{r.section}</Td>
                    <Td>
                      {r.calculationMethod}
                      {r.assumptionWarning && (
                        <div className="mt-1">
                          <Badge tone="warning">Assumption</Badge> <span className="text-xs text-[var(--clay)]">{r.assumptionWarning}</span>
                        </div>
                      )}
                    </Td>
                    <Td>{r.limitValue ? inr(r.limitValue) : "-"}</Td>
                    <Td>{r.rateValue !== null && r.rateValue !== undefined ? (r.rateValue < 1 ? `${r.rateValue * 100}%` : inr(r.rateValue)) : "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
