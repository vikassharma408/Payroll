import { Card, Field, inputClass, Button } from "@/components/ui";
import { saveInvestmentDeclaration } from "@/lib/actions/investment";

interface Declaration {
  lic: number;
  epf: number;
  ppf: number;
  elss: number;
  lifeInsurance: number;
  tuitionFees: number;
  housingLoanPrincipal: number;
  otherSection80C: number;
  section80CCC: number;
  section80CCD1: number;
  section80CCD1B: number;
  section80DSelfBelow60: number;
  section80DParentsBelow60: number;
  section80DSelfAbove60: number;
  section80DParentsAbove60: number;
  section80E: number;
  section80EE: number;
  section80EEA: number;
  section80UBelow80: number;
  section80U80AndAbove: number;
  section80DDBelow80: number;
  section80DD80AndAbove: number;
  donations80G: number;
  homeLoanInterestSelfOccupied: number;
  letOutAnnualValue: number;
  letOutMunicipalTax: number;
  letOutHomeLoanInterest: number;
  monthlyRent: number;
  rentalAddress: string | null;
  landlordName: string | null;
  landlordPan: string | null;
  ltaClaimed: number;
  otherDeductions: number;
}

function NumField({ name, label, defaultValue }: { name: string; label: string; defaultValue: number }) {
  return (
    <Field label={label}>
      <input type="number" step="0.01" name={name} defaultValue={defaultValue || undefined} placeholder="0" className={inputClass} />
    </Field>
  );
}

export function InvestmentDeclarationForm({
  employeeId,
  financialYearId,
  financialYearCode,
  declaration,
}: {
  employeeId: string;
  financialYearId: string;
  financialYearCode: string;
  declaration?: Declaration;
}) {
  const d = declaration ?? ({} as Partial<Declaration>);
  async function handleSubmit(formData: FormData) {
    "use server";
    await saveInvestmentDeclaration(formData);
  }
  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="financialYearId" value={financialYearId} />

      <Card>
        <div className="mb-3 text-sm font-semibold">Investment Declaration - FY {financialYearCode}</div>
        <div className="mb-2 text-xs font-semibold uppercase text-[var(--muted)]">Section 80C basket (combined cap Rs 1,50,000 - old regime only)</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField name="lic" label="LIC Premium" defaultValue={d.lic ?? 0} />
          <NumField name="epf" label="EPF" defaultValue={d.epf ?? 0} />
          <NumField name="ppf" label="PPF" defaultValue={d.ppf ?? 0} />
          <NumField name="elss" label="ELSS" defaultValue={d.elss ?? 0} />
          <NumField name="lifeInsurance" label="Life Insurance" defaultValue={d.lifeInsurance ?? 0} />
          <NumField name="tuitionFees" label="Tuition Fees" defaultValue={d.tuitionFees ?? 0} />
          <NumField name="housingLoanPrincipal" label="Housing Loan Principal" defaultValue={d.housingLoanPrincipal ?? 0} />
          <NumField name="otherSection80C" label="Other 80C" defaultValue={d.otherSection80C ?? 0} />
          <NumField name="section80CCC" label="80CCC (Pension Fund)" defaultValue={d.section80CCC ?? 0} />
          <NumField name="section80CCD1" label="80CCD(1) NPS Employee" defaultValue={d.section80CCD1 ?? 0} />
        </div>

        <div className="mb-2 mt-4 text-xs font-semibold uppercase text-[var(--muted)]">NPS &amp; Medical Insurance</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField name="section80CCD1B" label="80CCD(1B) Additional NPS (cap 50,000)" defaultValue={d.section80CCD1B ?? 0} />
          <NumField name="section80DSelfBelow60" label="80D Self/Family (below 60)" defaultValue={d.section80DSelfBelow60 ?? 0} />
          <NumField name="section80DParentsBelow60" label="80D Parents (below 60)" defaultValue={d.section80DParentsBelow60 ?? 0} />
          <NumField name="section80DSelfAbove60" label="80D Self/Family (60+)" defaultValue={d.section80DSelfAbove60 ?? 0} />
          <NumField name="section80DParentsAbove60" label="80D Parents (60+)" defaultValue={d.section80DParentsAbove60 ?? 0} />
        </div>

        <div className="mb-2 mt-4 text-xs font-semibold uppercase text-[var(--muted)]">Other Deductions</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField name="section80E" label="80E Education Loan Interest" defaultValue={d.section80E ?? 0} />
          <NumField name="section80EE" label="80EE Home Loan Interest" defaultValue={d.section80EE ?? 0} />
          <NumField name="section80EEA" label="80EEA Home Loan Interest" defaultValue={d.section80EEA ?? 0} />
          <NumField name="section80UBelow80" label="80U Self Disability (<80%)" defaultValue={d.section80UBelow80 ?? 0} />
          <NumField name="section80U80AndAbove" label="80U Self Disability (80%+)" defaultValue={d.section80U80AndAbove ?? 0} />
          <NumField name="section80DDBelow80" label="80DD Dependent Disability (<80%)" defaultValue={d.section80DDBelow80 ?? 0} />
          <NumField name="section80DD80AndAbove" label="80DD Dependent Disability (80%+)" defaultValue={d.section80DD80AndAbove ?? 0} />
          <NumField name="donations80G" label="80G Donations" defaultValue={d.donations80G ?? 0} />
          <NumField name="ltaClaimed" label="LTA Claimed" defaultValue={d.ltaClaimed ?? 0} />
          <NumField name="otherDeductions" label="Other Eligible Deductions" defaultValue={d.otherDeductions ?? 0} />
        </div>

        <div className="mb-2 mt-4 text-xs font-semibold uppercase text-[var(--muted)]">House Property</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField name="homeLoanInterestSelfOccupied" label="Home Loan Interest (Self-Occupied, cap 2,00,000)" defaultValue={d.homeLoanInterestSelfOccupied ?? 0} />
          <NumField name="letOutAnnualValue" label="Let-out Property: Annual Value" defaultValue={d.letOutAnnualValue ?? 0} />
          <NumField name="letOutMunicipalTax" label="Let-out Property: Municipal Tax" defaultValue={d.letOutMunicipalTax ?? 0} />
          <NumField name="letOutHomeLoanInterest" label="Let-out Property: Home Loan Interest" defaultValue={d.letOutHomeLoanInterest ?? 0} />
        </div>

        <div className="mb-2 mt-4 text-xs font-semibold uppercase text-[var(--muted)]">HRA / Rent Details</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField name="monthlyRent" label="Monthly Rent Paid" defaultValue={d.monthlyRent ?? 0} />
          <Field label="Rental Address">
            <input name="rentalAddress" defaultValue={d.rentalAddress ?? ""} className={inputClass} />
          </Field>
          <Field label="Landlord Name">
            <input name="landlordName" defaultValue={d.landlordName ?? ""} className={inputClass} />
          </Field>
          <Field label="Landlord PAN">
            <input name="landlordPan" defaultValue={d.landlordPan ?? ""} className={inputClass} />
          </Field>
        </div>

        <div className="mt-4">
          <Button type="submit">Save Investment Declaration</Button>
        </div>
      </Card>
    </form>
  );
}
