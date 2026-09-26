import { Card, Field, inputClass, Button, Th, Td, inr, EmptyState } from "@/components/ui";
import { savePreviousEmployerIncome, deletePreviousEmployerIncome } from "@/lib/actions/previous-employer";

interface Row {
  id: string;
  employerName: string;
  periodFrom: Date;
  periodTo: Date;
  grossSalary: number;
  taxableSalary: number;
  exemptions: number;
  deductions: number;
  tdsDeducted: number;
}

export function PreviousEmployerSection({
  employeeId,
  financialYearId,
  financialYearCode,
  rows,
}: {
  employeeId: string;
  financialYearId: string;
  financialYearCode: string;
  rows: Row[];
}) {
  async function handleAdd(formData: FormData) {
    "use server";
    await savePreviousEmployerIncome(formData);
  }
  async function handleDelete(rowId: string) {
    "use server";
    await deletePreviousEmployerIncome(rowId, employeeId);
  }
  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">Previous Employer Income - FY {financialYearCode}</div>
      <div className="mb-4">
        {rows.length === 0 ? (
          <EmptyState message="No previous employer income recorded for this financial year." />
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Employer</Th>
                <Th>Period</Th>
                <Th>Gross Salary</Th>
                <Th>Taxable Salary</Th>
                <Th>TDS</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.employerName}</Td>
                  <Td>
                    {r.periodFrom.toISOString().slice(0, 10)} to {r.periodTo.toISOString().slice(0, 10)}
                  </Td>
                  <Td>{inr(r.grossSalary)}</Td>
                  <Td>{inr(r.taxableSalary)}</Td>
                  <Td>{inr(r.tdsDeducted)}</Td>
                  <Td>
                    <form action={handleDelete.bind(null, r.id)}>
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        Remove
                      </button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs font-semibold uppercase text-[var(--muted)] mb-2">Add Previous Employer Record</div>
      <form action={handleAdd} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="financialYearId" value={financialYearId} />
        <Field label="Employer Name *">
          <input name="employerName" required className={inputClass} />
        </Field>
        <Field label="Period From *">
          <input type="date" name="periodFrom" required className={inputClass} />
        </Field>
        <Field label="Period To *">
          <input type="date" name="periodTo" required className={inputClass} />
        </Field>
        <Field label="Gross Salary *">
          <input type="number" step="0.01" name="grossSalary" required className={inputClass} />
        </Field>
        <Field label="Taxable Salary *">
          <input type="number" step="0.01" name="taxableSalary" required className={inputClass} />
        </Field>
        <Field label="Exemptions">
          <input type="number" step="0.01" name="exemptions" className={inputClass} />
        </Field>
        <Field label="Deductions">
          <input type="number" step="0.01" name="deductions" className={inputClass} />
        </Field>
        <Field label="TDS Deducted">
          <input type="number" step="0.01" name="tdsDeducted" className={inputClass} />
        </Field>
        <div className="col-span-full">
          <Button type="submit">Add Record</Button>
        </div>
      </form>
    </Card>
  );
}
