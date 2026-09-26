import { fyMonthIndexToCalendar } from "@/lib/types";

/** Inverse of fyMonthIndexToCalendar: calendar month/year -> FY month index (1=April..12=March). */
export function calendarToFyMonthIndex(calendarYear: number, calendarMonth: number): number {
  if (calendarMonth >= 4) return calendarMonth - 3;
  return calendarMonth + 9;
}

export function daysInCalendarMonth(calendarYear: number, calendarMonth: number): number {
  return new Date(calendarYear, calendarMonth, 0).getDate();
}

export { fyMonthIndexToCalendar };

export const FY_MONTH_LABELS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
];
