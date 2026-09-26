import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "@/components/employee-form";
import { updateEmployee } from "@/lib/actions/employees";
import { notFound } from "next/navigation";

function fmtDate(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : undefined;
}

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  return (
    <div>
      <PageHeader title={`Edit ${employee.fullName}`} description={employee.employeeCode} />
      <EmployeeForm
        action={updateEmployee.bind(null, employee.id)}
        submitLabel="Save Changes"
        defaultValues={{
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          dob: fmtDate(employee.dob),
          gender: employee.gender ?? undefined,
          pan: employee.pan ?? undefined,
          email: employee.email ?? undefined,
          phone: employee.phone ?? undefined,
          dateOfJoining: fmtDate(employee.dateOfJoining),
          dateOfLeaving: fmtDate(employee.dateOfLeaving),
          department: employee.department ?? undefined,
          designation: employee.designation ?? undefined,
          location: employee.location ?? undefined,
          payrollGroup: employee.payrollGroup ?? undefined,
          uan: employee.uan ?? undefined,
          pfApplicable: employee.pfApplicable,
          esiApplicable: employee.esiApplicable,
          ptApplicable: employee.ptApplicable,
          taxRegime: employee.taxRegime,
          status: employee.status,
          isMetroCity: employee.isMetroCity,
          bankName: employee.bankName ?? undefined,
          bankAccountNo: employee.bankAccountNo ?? undefined,
          bankIfsc: employee.bankIfsc ?? undefined,
        }}
      />
    </div>
  );
}
