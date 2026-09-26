import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "@/components/employee-form";
import { createEmployee } from "@/lib/actions/employees";

export default function NewEmployeePage() {
  return (
    <div>
      <PageHeader title="Add Employee" description="Create a new employee master record" />
      <EmployeeForm action={createEmployee} submitLabel="Create Employee" />
    </div>
  );
}
