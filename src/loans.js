// Loan & advance register: employer loans recovered through payroll.
//
// Nothing about a loan's repayment history is stored on the loan itself -
// each processed payroll line records the EMI it actually recovered
// (line.loanRecoveries), and a loan's outstanding balance is always derived
// from those lines plus any repayments recorded outside payroll. That keeps
// recalculating a run idempotent: a month's EMI is worked out only from
// recoveries in EARLIER months, so re-running the same month never double
// counts.
//
// Interest (if any) is charged monthly on the reducing balance; an
// interest-free loan just recovers principal. The concessional-loan
// perquisite (Income-tax Rules, 2026, Rule 15) is valued here too, from the
// same balances: (SBI rate on 1 April for that loan type - rate charged) x
// the month's maximum outstanding balance, nil for medical-treatment loans or
// while the employee's loans together stay within the exempt aggregate.

const LOAN_TYPES = [
  { key: "SALARY_ADVANCE", label: "Salary Advance" },
  { key: "PERSONAL", label: "Personal Loan" },
  { key: "VEHICLE", label: "Vehicle Loan" },
  { key: "HOUSING", label: "Housing Loan" },
  { key: "EDUCATION", label: "Education Loan" },
  { key: "MEDICAL", label: "Medical Treatment Loan (specified diseases)" },
  { key: "OTHER", label: "Other Loan" },
];

function loanMonthKey(calendarYear, calendarMonth) {
  return calendarYear * 12 + (calendarMonth - 1);
}

function loanTypeLabel(key) {
  const t = LOAN_TYPES.find((x) => x.key === key);
  return t ? t.label : key;
}

function loanLabel(loan) {
  return `${loanTypeLabel(loan.loanType)}${loan.reference ? ` (${loan.reference})` : ""}`;
}

/** Month key of a "YYYY-MM-DD" date string, read without timezone shifts. */
function loanDateKey(isoDate) {
  const [y, m] = String(isoDate).slice(0, 10).split("-").map(Number);
  return loanMonthKey(y, m);
}

function loanRecoveryEntries(db, loan) {
  const out = [];
  for (const run of db.payrollRuns) {
    const line = run.lines.find((l) => l.employeeId === loan.employeeId);
    if (!line || !line.loanRecoveries) continue;
    for (const r of line.loanRecoveries) {
      if (r.loanId === loan.id) out.push({ run, line, key: loanMonthKey(run.calendarYear, run.calendarMonth), ...r });
    }
  }
  return out.sort((a, b) => a.key - b.key);
}

/** Principal still outstanding at the START of the given month (recoveries from earlier months and repayments dated before the month applied). */
function loanOutstandingBefore(db, loan, beforeKey) {
  let outstanding = loan.principal;
  for (const r of loanRecoveryEntries(db, loan)) if (r.key < beforeKey) outstanding -= r.principal;
  for (const p of loan.manualRepayments || []) if (loanDateKey(p.date) < beforeKey) outstanding -= p.amount;
  return Math.max(0, Math.round(outstanding * 100) / 100);
}

function loanOutstandingNow(db, loan) {
  let outstanding = loan.principal;
  for (const r of loanRecoveryEntries(db, loan)) outstanding -= r.principal;
  for (const p of loan.manualRepayments || []) outstanding -= p.amount;
  return Math.max(0, Math.round(outstanding * 100) / 100);
}

function loanMonthlyInterest(balance, ratePa) {
  return Math.round((balance * (ratePa || 0)) / 1200);
}

/**
 * EMIs due from an employee in the given payroll month (before any net-pay
 * cap). On the final month of service (`isFinalMonth`) the whole remaining
 * balance falls due, as at Full & Final Settlement.
 */
function computeLoanEmisDue(db, employeeId, calendarYear, calendarMonth, currentRunId, isFinalMonth) {
  const key = loanMonthKey(calendarYear, calendarMonth);
  const due = [];
  for (const loan of (db.employeeLoans || []).filter((l) => l.employeeId === employeeId && l.status === "ACTIVE")) {
    if (loanMonthKey(loan.firstRecoveryYear, loan.firstRecoveryMonth) > key) continue;
    // Another run for this same month already recovered this loan (e.g. a
    // supplementary run) - don't take the EMI twice.
    const alreadyThisMonth = db.payrollRuns.some((r) => r.id !== currentRunId && loanMonthKey(r.calendarYear, r.calendarMonth) === key && r.lines.some((l) => l.employeeId === employeeId && (l.loanRecoveries || []).some((x) => x.loanId === loan.id)));
    if (alreadyThisMonth) continue;
    const outstanding = loanOutstandingBefore(db, loan, key);
    if (outstanding < 1) continue;
    const interest = loanMonthlyInterest(outstanding, loan.interestRatePa);
    const amount = Math.round(isFinalMonth ? outstanding + interest : Math.min(loan.emiAmount, outstanding + interest));
    due.push({ loanId: loan.id, loanLabel: loanLabel(loan), outstandingBefore: outstanding, interest: Math.min(interest, amount), amount });
  }
  return due;
}

/** Splits what could actually be recovered (`available` net pay) across the loans due - interest first, then principal. */
function allocateLoanRecoveries(dueList, available) {
  let left = Math.max(0, available);
  return dueList.map((d) => {
    const amount = Math.min(d.amount, left);
    left -= amount;
    const interest = Math.min(d.interest, amount);
    const principal = amount - interest;
    return {
      loanId: d.loanId,
      loanLabel: d.loanLabel,
      amount,
      interest,
      principal,
      balanceAfter: Math.max(0, Math.round((d.outstandingBefore - principal) * 100) / 100),
      shortfall: d.amount - amount,
    };
  });
}

/** Month-by-month schedule for display: actual recoveries for processed months, projected EMIs after that until the loan is cleared. */
function buildLoanSchedule(db, loan, maxMonths) {
  const rows = [];
  const actual = loanRecoveryEntries(db, loan);
  const actualByKey = new Map(actual.map((r) => [r.key, r]));
  const startKey = Math.min(loanMonthKey(loan.firstRecoveryYear, loan.firstRecoveryMonth), actual.length ? actual[0].key : Infinity);
  const lastActualKey = actual.length ? actual[actual.length - 1].key : -Infinity;
  let balance = null;
  for (let i = 0, key = startKey; i < (maxMonths || 360); i++, key++) {
    const year = Math.floor(key / 12);
    const month = (key % 12) + 1;
    if (key <= lastActualKey) {
      const opening = loanOutstandingBefore(db, loan, key);
      const a = actualByKey.get(key);
      rows.push(
        a
          ? { year, month, status: a.shortfall ? "Part recovered" : "Recovered", amount: a.amount, interest: a.interest, principal: a.principal, balanceAfter: Math.max(0, opening - a.principal) }
          : { year, month, status: "Not recovered", amount: 0, interest: 0, principal: 0, balanceAfter: opening },
      );
      continue;
    }
    if (balance === null) balance = loanOutstandingBefore(db, loan, key);
    if (balance < 1 || loan.status !== "ACTIVE") break;
    const interest = loanMonthlyInterest(balance, loan.interestRatePa);
    const amount = Math.min(loan.emiAmount, balance + interest);
    const principal = amount - interest;
    if (principal <= 0) {
      rows.push({ year, month, status: "EMI below interest", amount, interest, principal: 0, balanceAfter: balance });
      break;
    }
    balance -= principal;
    rows.push({ year, month, status: "Projected", amount, interest, principal, balanceAfter: Math.max(0, balance) });
  }
  return rows;
}

/** Equal monthly instalment for a principal over `months` at `ratePa` % (reducing balance); plain principal / months when interest-free. */
function suggestLoanEmi(principal, ratePa, months) {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = (ratePa || 0) / 1200;
  if (!r) return Math.ceil(principal / months);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/**
 * Taxable perquisite for concessional / interest-free employer loans over
 * one financial year, month by month. A month's balance is the actual
 * outstanding at its start for months already processed, and the projected
 * EMI schedule for months still to come. `fyMonths` is the list of
 * { calendarYear, calendarMonth } in service this FY; `rates` is the
 * perquisite rate card in force (exempt aggregate threshold).
 */
function computeLoanPerquisite(db, employeeId, fyMonths, rates) {
  const loans = (db.employeeLoans || []).filter((l) => l.employeeId === employeeId);
  const breakdown = [];
  if (!loans.length) return { total: 0, breakdown };
  const exemptAggregate = rates.loanExemptAggregate ?? 200000;
  const processedKeys = db.payrollRuns.filter((r) => r.lines.some((l) => l.employeeId === employeeId)).map((r) => loanMonthKey(r.calendarYear, r.calendarMonth));
  const fyKeys = fyMonths.map((m) => loanMonthKey(m.calendarYear, m.calendarMonth));
  // First month whose balance isn't settled by processed payroll yet - from
  // here on balances are projected from the EMI schedule.
  const projectFromKey = processedKeys.length ? Math.max(...processedKeys) + 1 : fyKeys.length ? Math.min(...fyKeys) : 0;

  const balanceAt = (loan, key) => {
    if (loanDateKey(loan.sanctionDate) > key) return 0;
    if (key <= projectFromKey) return loanOutstandingBefore(db, loan, key);
    let bal = loanOutstandingBefore(db, loan, projectFromKey);
    for (let k = projectFromKey; k < key && bal >= 1; k++) {
      if (loan.status !== "ACTIVE" || k < loanMonthKey(loan.firstRecoveryYear, loan.firstRecoveryMonth)) continue;
      const interest = loanMonthlyInterest(bal, loan.interestRatePa);
      bal -= Math.max(0, Math.min(loan.emiAmount, bal + interest) - interest);
    }
    return Math.max(0, bal);
  };

  const perLoan = new Map(loans.map((l) => [l.id, 0]));
  for (const { calendarYear, calendarMonth } of fyMonths) {
    const key = loanMonthKey(calendarYear, calendarMonth);
    const balances = loans.map((l) => ({ loan: l, balance: balanceAt(l, key) }));
    const aggregate = balances.filter((b) => b.loan.loanType !== "MEDICAL").reduce((s, b) => s + b.balance, 0);
    if (aggregate <= exemptAggregate) continue;
    for (const { loan, balance } of balances) {
      if (loan.loanType === "MEDICAL" || !balance) continue;
      const concession = Math.max(0, (loan.sbiRatePa || 0) - (loan.interestRatePa || 0));
      perLoan.set(loan.id, perLoan.get(loan.id) + (balance * concession) / 1200);
    }
  }
  let total = 0;
  for (const loan of loans) {
    const value = Math.round(perLoan.get(loan.id));
    total += value;
    const note =
      loan.loanType === "MEDICAL"
        ? "Loan for medical treatment of specified diseases - not a taxable perquisite."
        : !loan.sbiRatePa
          ? "SBI benchmark rate not entered on this loan - enter it in Loans & Advances to value the perquisite."
          : `(${loan.sbiRatePa}% SBI rate - ${loan.interestRatePa || 0}% charged) x monthly outstanding balance; nil in months when total loans are within Rs ${exemptAggregate.toLocaleString("en-IN")} (${rates.ruleRef}).`;
    breakdown.push({ id: null, type: "LOAN", label: `${loanLabel(loan)} - Rs ${loan.principal.toLocaleString("en-IN")} @ ${loan.interestRatePa || 0}%`, taxableValue: value, note });
  }
  return { total, breakdown };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LOAN_TYPES, loanMonthKey, loanTypeLabel, loanLabel, loanRecoveryEntries, loanOutstandingBefore, loanOutstandingNow,
    computeLoanEmisDue, allocateLoanRecoveries, buildLoanSchedule, suggestLoanEmi, computeLoanPerquisite,
  };
}
