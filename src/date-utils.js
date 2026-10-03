// Shared date display/input helpers. The data model and every computation
// in this app stores and works with plain ISO "YYYY-MM-DD" strings
// throughout (unchanged by any of this) - these helpers only affect how a
// date is SHOWN to the user and how a date TYPED or pasted by the user (in
// the app, or in an imported Excel file) gets turned back into that same
// ISO string.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO "YYYY-MM-DD" (or a full ISO datetime, only the date part is used) -> "DD/Mon/YYYY" for display, e.g. "03/Oct/2026". Returns "" for a missing/invalid input. */
function formatDateDisplay(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const [, y, mo, d] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return "";
  return `${d}/${MONTH_ABBR[monthIdx]}/${y}`;
}

/**
 * Accepts a date typed/pasted by a user or read from an Excel cell in any of
 * several common forms, and normalizes it to an ISO "YYYY-MM-DD" string (or
 * null if it can't be parsed as a real date):
 *   - a JS Date object (Excel's own native date cells, read with cellDates:true)
 *   - "DD/Mon/YYYY" or "DD-Mon-YYYY" (e.g. "03/Oct/2026") - this app's own display/typed format
 *   - "DD/MM/YYYY" or "DD-MM-YYYY" (e.g. "03/10/2026") - plain numeric day-first, also commonly typed
 *   - "YYYY-MM-DD" (ISO) - already-correct values, and anything restored from an older backup/template
 */
function parseFlexibleDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const str = String(value).trim();
  if (!str) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return normalizeYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[/\-]([A-Za-z]{3,9}|\d{1,2})[/\-](\d{4})$/.exec(str);
  if (dmy) {
    const day = Number(dmy[1]);
    const year = Number(dmy[3]);
    const monthToken = dmy[2];
    let month;
    if (/^\d+$/.test(monthToken)) {
      month = Number(monthToken);
    } else {
      month = MONTH_ABBR.findIndex((m) => m.toLowerCase() === monthToken.slice(0, 3).toLowerCase()) + 1;
      if (month === 0) return null;
    }
    return normalizeYmd(year, month, day);
  }

  // Last resort: let the JS Date parser try (handles things like
  // "Oct 3, 2026" that a user might paste from elsewhere) - never relied on
  // for the app's own day-first formats above, since new Date(string) reads
  // an ambiguous numeric string as month-first.
  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, "0")}-${String(fallback.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function normalizeYmd(year, month, day) {
  if (!year || !month || month < 1 || month > 12 || !day) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Renders a date field that behaves like a single `<input type="date"
 * name="...">` to any existing FormData-based save handler (a hidden input
 * keeps that exact name and an ISO value), while giving the person two ways
 * to set it: typing 8 digits (auto-formatted as DD/Mon/YYYY as they go), or
 * the calendar-icon button, which opens a native date picker.
 */
function dateField(name, isoValue, opts) {
  opts = opts || {};
  const extra = opts.extraAttrs || "";
  const idAttr = opts.id ? ` id="${escapeHtml(opts.id)}"` : "";
  return `
    <div class="date-field">
      <input type="hidden" name="${escapeHtml(name)}"${idAttr} class="date-field-hidden" value="${escapeHtml(isoValue || "")}" />
      <input type="text" inputmode="numeric" class="date-field-text" placeholder="DD/Mon/YYYY" maxlength="11" autocomplete="off" value="${escapeHtml(formatDateDisplay(isoValue))}" ${extra} />
      <button type="button" class="date-field-pick" title="Pick a date" tabindex="-1">&#128197;</button>
      <input type="date" class="date-field-native" tabindex="-1" value="${escapeHtml(isoValue || "")}" />
    </div>
  `;
}

/** Wires up every .date-field inside `root` - call once after each render() that produced one or more dateField() widgets. */
function wireDateFields(root) {
  root.querySelectorAll(".date-field").forEach((wrap) => {
    if (wrap.dataset.wired) return;
    wrap.dataset.wired = "1";
    const hidden = wrap.querySelector(".date-field-hidden");
    const text = wrap.querySelector(".date-field-text");
    const native = wrap.querySelector(".date-field-native");
    const pickBtn = wrap.querySelector(".date-field-pick");

    text.addEventListener("input", (e) => {
      const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
      let formatted = digits;
      if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      else if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      e.target.value = formatted;
      text.classList.remove("date-field-invalid");
      if (digits.length === 8) {
        const iso = parseFlexibleDate(`${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`);
        if (iso) {
          setHidden(iso);
          native.value = iso;
          text.value = formatDateDisplay(iso);
        } else {
          text.classList.add("date-field-invalid");
          setHidden("");
        }
      } else {
        setHidden("");
      }
    });
    pickBtn.addEventListener("click", () => {
      if (native.showPicker) native.showPicker();
      else native.focus();
    });
    native.addEventListener("change", () => {
      setHidden(native.value);
      text.value = formatDateDisplay(native.value);
      text.classList.remove("date-field-invalid");
    });

    // Setting .value directly never fires a "change"/"input" event, so any
    // pre-existing code elsewhere that listens for one on this hidden input
    // (keyed by the same `name`/`id` a plain <input type="date"> used to
    // have) would otherwise silently stop being notified.
    function setHidden(value) {
      hidden.value = value;
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { formatDateDisplay, parseFlexibleDate, dateField, wireDateFields, MONTH_ABBR };
}
