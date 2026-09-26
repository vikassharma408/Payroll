import { prisma } from "@/lib/db";
import { PageHeader, Card, Field, inputClass, Button } from "@/components/ui";
import { saveCompany } from "@/lib/actions/company";

export default async function CompanySettingsPage() {
  const company = await prisma.company.findFirst();

  async function handleSave(formData: FormData) {
    "use server";
    await saveCompany(formData);
  }

  return (
    <div>
      <PageHeader title="Company Settings" description="Used on salary slips, bank files and reports" />
      <form action={handleSave}>
        <Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Company Name *">
              <input name="name" required defaultValue={company?.name} className={inputClass} />
            </Field>
            <Field label="Address">
              <input name="address" defaultValue={company?.address ?? ""} className={inputClass} />
            </Field>
            <Field label="PAN">
              <input name="pan" defaultValue={company?.pan ?? ""} className={inputClass} />
            </Field>
            <Field label="TAN">
              <input name="tan" defaultValue={company?.tan ?? ""} className={inputClass} />
            </Field>
            <Field label="Bank Name">
              <input name="bankName" defaultValue={company?.bankName ?? ""} className={inputClass} />
            </Field>
            <Field label="Bank Account No">
              <input name="bankAccountNo" defaultValue={company?.bankAccountNo ?? ""} className={inputClass} />
            </Field>
            <Field label="Bank IFSC">
              <input name="bankIfsc" defaultValue={company?.bankIfsc ?? ""} className={inputClass} />
            </Field>
          </div>
          <div className="mt-4">
            <Button type="submit">Save</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
