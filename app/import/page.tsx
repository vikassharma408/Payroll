import { PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/import-wizard";

export default function ImportPage() {
  return (
    <div>
      <PageHeader title="Import Data Wizard" description="Download a template, fill it in Excel, upload, validate, and import." />
      <ImportWizard />
    </div>
  );
}
