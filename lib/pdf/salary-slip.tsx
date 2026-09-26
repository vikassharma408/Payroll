import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { FY_MONTH_NAMES } from "@/lib/types";
import { prisma } from "@/lib/db";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: "2 solid #1a1a1a", paddingBottom: 8, marginBottom: 8 },
  companyName: { fontSize: 14, fontWeight: 700 },
  muted: { color: "#555555" },
  title: { fontSize: 12, fontWeight: 700, textAlign: "center", marginVertical: 8, textTransform: "uppercase" },
  infoGrid: { flexDirection: "row", marginBottom: 8 },
  infoCol: { flex: 1 },
  infoRow: { flexDirection: "row", marginBottom: 2 },
  infoLabel: { width: 110, color: "#555555" },
  tableRow: { flexDirection: "row", borderBottom: "0.5 solid #dddddd", paddingVertical: 3 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f0f0f0", paddingVertical: 4, fontWeight: 700 },
  col: { flex: 1 },
  colAmount: { flex: 1, textAlign: "right" },
  sectionTitle: { fontWeight: 700, fontSize: 10, marginTop: 10, marginBottom: 4 },
  totalRow: { flexDirection: "row", borderTop: "1 solid #1a1a1a", paddingVertical: 4, fontWeight: 700 },
  netBox: { marginTop: 12, padding: 8, backgroundColor: "#f0f0f0", flexDirection: "row", justifyContent: "space-between" },
  footer: { marginTop: 16, fontSize: 8, color: "#777777", textAlign: "center" },
});

function maskAccount(acc: string | null) {
  if (!acc) return "-";
  if (acc.length <= 4) return acc;
  return "X".repeat(acc.length - 4) + acc.slice(-4);
}

function inr(n: number) {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

const COMPONENT_LABELS: Record<string, string> = {
  BASIC: "Basic Salary",
  DA: "Dearness Allowance",
  HRA: "House Rent Allowance",
  SPECIAL_ALLOWANCE: "Special Allowance",
  CONVEYANCE: "Conveyance Allowance",
  TRANSPORT_ALLOWANCE: "Transport Allowance",
  MEDICAL_ALLOWANCE: "Medical Allowance",
  LTA: "LTA / LTC",
  BONUS: "Bonus",
  INCENTIVE: "Incentive",
  COMMISSION: "Commission",
  OVERTIME: "Overtime",
  ARREARS: "Arrears",
  PERFORMANCE_PAY: "Performance Pay",
  OTHER_ALLOWANCE: "Other Allowances",
  EMPLOYER_PF: "Employer PF",
  EMPLOYER_NPS: "Employer NPS",
  EMPLOYER_SUPERANNUATION: "Employer Superannuation",
  GRATUITY: "Gratuity",
  OTHER_EMPLOYER_BENEFIT: "Other Employer Benefits",
  EMPLOYEE_PF: "Employee PF",
  EMPLOYEE_ESI: "Employee ESI",
  PROFESSIONAL_TAX: "Professional Tax",
  LWF: "Labour Welfare Fund",
  SALARY_ADVANCE: "Salary Advance Recovery",
  LOAN_RECOVERY: "Loan Recovery",
  OTHER_DEDUCTION: "Other Deductions",
};

export async function getSalarySlipData(lineId: string) {
  const line = await prisma.payrollRunLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { employee: true, payrollRun: { include: { financialYear: true } }, adjustments: true },
  });
  const company = await prisma.company.findFirst();

  const priorLines = await prisma.payrollRunLine.findMany({
    where: { employeeId: line.employeeId, payrollRun: { financialYearId: line.payrollRun.financialYearId, payrollMonthIndex: { lte: line.payrollRun.payrollMonthIndex } } },
  });
  const ytd = priorLines.reduce(
    (acc, l) => {
      acc.gross += l.grossSalary;
      acc.deductions += l.totalDeductions;
      acc.tds += l.tdsMonthly;
      acc.net += l.netSalary;
      return acc;
    },
    { gross: 0, deductions: 0, tds: 0, net: 0 },
  );

  const snapshot = JSON.parse(line.taxCalcSnapshot) as { old: { totalTaxLiability: number }; new: { totalTaxLiability: number } };

  return {
    company,
    employee: line.employee,
    line,
    ytd,
    monthLabel: `${FY_MONTH_NAMES[line.payrollRun.payrollMonthIndex - 1]} ${line.payrollRun.calendarYear}`,
    fyLabel: line.payrollRun.financialYear.code,
    annualTaxLiability: line.regimeUsed === "OLD" ? snapshot.old.totalTaxLiability : snapshot.new.totalTaxLiability,
  };
}

export async function renderSalarySlipPdf(lineId: string): Promise<Buffer> {
  const data = await getSalarySlipData(lineId);
  const earnings = JSON.parse(data.line.earnings) as Record<string, number>;
  const employerContrib = JSON.parse(data.line.employerContributions) as Record<string, number>;
  const deductionsMap = JSON.parse(data.line.deductions) as Record<string, number>;
  const adjustmentsTotal = data.line.adjustments.reduce((s, a) => s + a.amount, 0);

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{data.company?.name ?? "Company Name"}</Text>
            <Text style={styles.muted}>{data.company?.address ?? ""}</Text>
            <Text style={styles.muted}>PAN: {data.company?.pan ?? "-"}  TAN: {data.company?.tan ?? "-"}</Text>
          </View>
          <View>
            <Text style={styles.muted}>Payslip for {data.monthLabel}</Text>
            <Text style={styles.muted}>FY {data.fyLabel}</Text>
          </View>
        </View>
        <Text style={styles.title}>Payslip - {data.monthLabel}</Text>

        <View style={styles.infoGrid}>
          <View style={styles.infoCol}>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Employee Code</Text><Text>{data.employee.employeeCode}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Employee Name</Text><Text>{data.employee.fullName}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Designation</Text><Text>{data.employee.designation ?? "-"}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Department</Text><Text>{data.employee.department ?? "-"}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>PAN</Text><Text>{data.employee.pan ?? "-"}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>UAN</Text><Text>{data.employee.uan ?? "-"}</Text></View>
          </View>
          <View style={styles.infoCol}>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Bank Name</Text><Text>{data.employee.bankName ?? "-"}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Account No.</Text><Text>{maskAccount(data.employee.bankAccountNo)}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Days in Month</Text><Text>{data.line.daysInMonth}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Days Worked</Text><Text>{data.line.daysWorked}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>LOP Days</Text><Text>{data.line.lopDays}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Tax Regime</Text><Text>{data.line.regimeUsed}</Text></View>
          </View>
        </View>

        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.sectionTitle}>Earnings</Text>
            <View style={styles.tableHeader}><Text style={styles.col}>Component</Text><Text style={styles.colAmount}>Amount</Text></View>
            {Object.entries(earnings).filter(([, v]) => v !== 0).map(([code, amt]) => (
              <View style={styles.tableRow} key={code}><Text style={styles.col}>{COMPONENT_LABELS[code] ?? code}</Text><Text style={styles.colAmount}>{inr(amt)}</Text></View>
            ))}
            <View style={styles.totalRow}><Text style={styles.col}>Gross Salary</Text><Text style={styles.colAmount}>{inr(data.line.grossSalary)}</Text></View>

            <Text style={styles.sectionTitle}>Employer Contributions</Text>
            <View style={styles.tableHeader}><Text style={styles.col}>Component</Text><Text style={styles.colAmount}>Amount</Text></View>
            {Object.entries(employerContrib).filter(([, v]) => v !== 0).map(([code, amt]) => (
              <View style={styles.tableRow} key={code}><Text style={styles.col}>{COMPONENT_LABELS[code] ?? code}</Text><Text style={styles.colAmount}>{inr(amt)}</Text></View>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Deductions</Text>
            <View style={styles.tableHeader}><Text style={styles.col}>Component</Text><Text style={styles.colAmount}>Amount</Text></View>
            {Object.entries(deductionsMap).filter(([, v]) => v !== 0).map(([code, amt]) => (
              <View style={styles.tableRow} key={code}><Text style={styles.col}>{COMPONENT_LABELS[code] ?? code}</Text><Text style={styles.colAmount}>{inr(amt)}</Text></View>
            ))}
            <View style={styles.tableRow}><Text style={styles.col}>TDS</Text><Text style={styles.colAmount}>{inr(data.line.tdsMonthly)}</Text></View>
            {adjustmentsTotal !== 0 && (
              <View style={styles.tableRow}><Text style={styles.col}>Adjustments</Text><Text style={styles.colAmount}>{inr(adjustmentsTotal)}</Text></View>
            )}
            <View style={styles.totalRow}><Text style={styles.col}>Total Deductions</Text><Text style={styles.colAmount}>{inr(data.line.totalDeductions - adjustmentsTotal)}</Text></View>

            <Text style={styles.sectionTitle}>Tax Summary</Text>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Regime Used</Text><Text>{data.line.regimeUsed}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>Annual Tax Liability</Text><Text>{inr(data.annualTaxLiability)}</Text></View>
            <View style={styles.infoRow}><Text style={styles.infoLabel}>TDS this Month</Text><Text>{inr(data.line.tdsMonthly)}</Text></View>
          </View>
        </View>

        <View style={styles.netBox}>
          <Text>Net Salary Payable</Text>
          <Text>{inr(data.line.netSalary)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Year-to-Date Totals (FY {data.fyLabel}, through {data.monthLabel})</Text>
        <View style={styles.tableHeader}><Text style={styles.col}>Gross (YTD)</Text><Text style={styles.col}>Deductions (YTD)</Text><Text style={styles.col}>TDS (YTD)</Text><Text style={styles.col}>Net (YTD)</Text></View>
        <View style={styles.tableRow}>
          <Text style={styles.col}>{inr(data.ytd.gross)}</Text>
          <Text style={styles.col}>{inr(data.ytd.deductions)}</Text>
          <Text style={styles.col}>{inr(data.ytd.tds)}</Text>
          <Text style={styles.col}>{inr(data.ytd.net)}</Text>
        </View>

        <Text style={styles.footer}>This is a system-generated payslip and does not require a signature.</Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
