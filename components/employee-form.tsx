"use client";

import { useActionState } from "react";
import { Field, inputClass, Button, Card } from "@/components/ui";
import type { ActionResult } from "@/lib/actions/employees";

interface EmployeeFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaultValues?: Partial<{
    employeeCode: string;
    fullName: string;
    dob: string;
    gender: string;
    pan: string;
    email: string;
    phone: string;
    dateOfJoining: string;
    dateOfLeaving: string;
    department: string;
    designation: string;
    location: string;
    payrollGroup: string;
    uan: string;
    pfApplicable: boolean;
    esiApplicable: boolean;
    ptApplicable: boolean;
    taxRegime: string;
    status: string;
    isMetroCity: boolean;
    bankName: string;
    bankAccountNo: string;
    bankIfsc: string;
  }>;
  submitLabel?: string;
}

const initialState: ActionResult = { ok: true };

export function EmployeeForm({ action, defaultValues = {}, submitLabel = "Save Employee" }: EmployeeFormProps) {
  const [state, formAction, pending] = useActionState(async (_: ActionResult, formData: FormData) => action(formData), initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--bad)_35%,transparent)] bg-[color-mix(in_srgb,var(--bad)_10%,transparent)] px-3 py-2 text-sm text-[var(--bad-text)]">{state.error}</div>
      )}

      <Card>
        <div className="mb-3 text-sm font-semibold">Personal Details</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Employee Code *">
            <input name="employeeCode" required defaultValue={defaultValues.employeeCode} className={inputClass} />
          </Field>
          <Field label="Full Name *">
            <input name="fullName" required defaultValue={defaultValues.fullName} className={inputClass} />
          </Field>
          <Field label="Date of Birth">
            <input type="date" name="dob" defaultValue={defaultValues.dob} className={inputClass} />
          </Field>
          <Field label="Gender">
            <select name="gender" defaultValue={defaultValues.gender ?? ""} className={inputClass}>
              <option value="">-</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="PAN" hint="Format: AAAAA9999A">
            <input name="pan" defaultValue={defaultValues.pan} className={inputClass} />
          </Field>
          <Field label="Email">
            <input type="email" name="email" defaultValue={defaultValues.email} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="phone" defaultValue={defaultValues.phone} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">Employment Details</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Date of Joining *">
            <input type="date" name="dateOfJoining" required defaultValue={defaultValues.dateOfJoining} className={inputClass} />
          </Field>
          <Field label="Date of Leaving">
            <input type="date" name="dateOfLeaving" defaultValue={defaultValues.dateOfLeaving} className={inputClass} />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={defaultValues.status ?? "ACTIVE"} className={inputClass}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="LEFT">Left</option>
            </select>
          </Field>
          <Field label="Department">
            <input name="department" defaultValue={defaultValues.department} className={inputClass} />
          </Field>
          <Field label="Designation">
            <input name="designation" defaultValue={defaultValues.designation} className={inputClass} />
          </Field>
          <Field label="Location">
            <input name="location" defaultValue={defaultValues.location} className={inputClass} />
          </Field>
          <Field label="Payroll Group">
            <input name="payrollGroup" defaultValue={defaultValues.payrollGroup} className={inputClass} />
          </Field>
          <Field label="UAN">
            <input name="uan" defaultValue={defaultValues.uan} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">Statutory &amp; Tax</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Tax Regime for TDS">
            <select name="taxRegime" defaultValue={defaultValues.taxRegime ?? "NEW"} className={inputClass}>
              <option value="NEW">New Regime</option>
              <option value="OLD">Old Regime</option>
            </select>
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="pfApplicable" defaultChecked={defaultValues.pfApplicable ?? true} /> PF Applicable
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="esiApplicable" defaultChecked={defaultValues.esiApplicable ?? false} /> ESI Applicable
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="ptApplicable" defaultChecked={defaultValues.ptApplicable ?? true} /> Professional Tax Applicable
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="isMetroCity" defaultChecked={defaultValues.isMetroCity ?? false} /> Resides in Metro City (for HRA)
          </label>
        </div>
      </Card>

      <Card>
        <div className="mb-3 text-sm font-semibold">Bank Details</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Bank Name">
            <input name="bankName" defaultValue={defaultValues.bankName} className={inputClass} />
          </Field>
          <Field label="Account Number">
            <input name="bankAccountNo" defaultValue={defaultValues.bankAccountNo} className={inputClass} />
          </Field>
          <Field label="IFSC" hint="Format: AAAA0999999">
            <input name="bankIfsc" defaultValue={defaultValues.bankIfsc} className={inputClass} />
          </Field>
        </div>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
