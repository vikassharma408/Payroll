// Ported from lib/payroll/dates.ts + the fyMonthIndexToCalendar helper in lib/types.ts
const FY_MONTH_NAMES = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];

function fyMonthIndexToCalendar(fyMonthIndex, fyStartYear) {
  const calendarMonth = ((fyMonthIndex - 1 + 3) % 12) + 1;
  const calendarYear = fyMonthIndex <= 9 ? fyStartYear : fyStartYear + 1;
  return { calendarYear, calendarMonth };
}

function calendarToFyMonthIndex(calendarYear, calendarMonth) {
  if (calendarMonth >= 4) return calendarMonth - 3;
  return calendarMonth + 9;
}

function daysInCalendarMonth(calendarYear, calendarMonth) {
  return new Date(calendarYear, calendarMonth, 0).getDate();
}

/** Completed age in years as of a given date - null if no date of birth is known. */
function computeAge(dobIso, asOfDateIso) {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  const asOf = new Date(asOfDateIso);
  let age = asOf.getFullYear() - dob.getFullYear();
  const hasHadBirthday = asOf.getMonth() > dob.getMonth() || (asOf.getMonth() === dob.getMonth() && asOf.getDate() >= dob.getDate());
  if (!hasHadBirthday) age -= 1;
  return age;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FY_MONTH_NAMES, fyMonthIndexToCalendar, calendarToFyMonthIndex, daysInCalendarMonth, computeAge };
}
