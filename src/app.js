// Application shell: db bootstrap, hash-based router, sidebar/topbar chrome,
// theme toggle, and the Dashboard / Tax Rules / Backup & Restore views.
// Feature screens (Employees, Payroll Runs, etc.) register themselves into
// `Views` the same way - see views/*.js.

const Views = {}; // path -> { label, section, render(container) }
function registerView(path, section, label, render) {
  Views[path] = { section, label, render };
}

const DYNAMIC_ROUTES = {}; // "employees" -> render(container, restSegments)
function registerDetailView(prefix, render) {
  DYNAMIC_ROUTES[prefix] = render;
}

let db = null;

function money(n) {
  const v = Math.round(n || 0);
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function rupees(n) {
  return `₹${money(n)}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Converts a SCREAMING_SNAKE_CASE enum/status value (ACTIVE, PROFESSIONAL_TAX,
 * SENIOR_60_79, UPTO_1600CC, ...) into a sentence-case display label, for
 * every raw status/regime/category/code shown directly to the user instead
 * of through a hand-written label map. Preserves standard tax-section/unit
 * notation (80C, 80CCD1B, 1600CC) by re-uppercasing a run of letters that
 * directly follows a digit, rather than blindly lowercasing everything.
 */
function sentenceCase(str) {
  if (!str) return "";
  let s = String(str).replace(/_/g, " ").toLowerCase();
  s = s.replace(/(\d)([a-z]+)/g, (_, d, letters) => d + letters.toUpperCase());
  s = s.replace(/([a-z])(\d)/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Records a change in db.auditLog - call before persist() so the log entry is saved along with the change itself. */
function logAudit(entityType, entityId, action, detail) {
  db.auditLog.push({ id: newId("log"), entityType, entityId, action, detail: detail || null, createdAt: new Date().toISOString() });
}

async function persist() {
  await Persistence.saveDb(db);
  let autoSaved = false;
  try {
    autoSaved = await Persistence.writeBackupToFolder(db);
  } catch (err) {
    console.warn("Auto-save to folder failed:", err);
  }
  updateBackupStatus(autoSaved);
}

// There is no "active company" switcher in the topbar any more - every
// create-form (Employee, Payroll Run, Template, Import) has its own
// explicit Legal Entity/Company select instead, so which company a new
// record belongs to is always a deliberate, visible choice on that form.
// getActiveCompanyId/setActiveCompanyId survive purely as a "remember my
// last choice" convenience - each of those selects defaults to whatever
// was picked last time, and updates it again on change - never as a
// standing, durable "current company" concept of its own.
const ACTIVE_COMPANY_KEY = "activeCompanyId";
function getActiveCompanyId() {
  const stored = localStorage.getItem(ACTIVE_COMPANY_KEY);
  if (stored && db.companies.some((c) => c.id === stored)) return stored;
  return db.companies[0] ? db.companies[0].id : null;
}
function setActiveCompanyId(id) {
  localStorage.setItem(ACTIVE_COMPANY_KEY, id);
}

// --- Company view filter -----------------------------------------------
// Separate from each create-form's own Legal Entity select (which decides
// where that one new record goes): this controls which companies' data
// shows up in list/report screens. Defaults to "all" so a fresh install or
// a single-entity user sees everything with no setup; a multi-entity user
// can narrow it to one or more specific companies. Stored independently so
// creating a record under a different entity never silently changes what
// you're currently browsing.
const COMPANY_FILTER_KEY = "companyFilter";
function getCompanyFilter() {
  try {
    const raw = localStorage.getItem(COMPANY_FILTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.mode === "selected" && Array.isArray(parsed.ids)) {
        // Drop ids for companies that no longer exist, but otherwise trust
        // this literally - including a deliberate empty selection (every
        // checkbox unticked), which is a real, distinct "showing nothing"
        // state now, not an error to silently paper over as "all".
        const validIds = parsed.ids.filter((id) => db.companies.some((c) => c.id === id));
        if (validIds.length < db.companies.length) return { mode: "selected", ids: validIds };
      }
    }
  } catch (err) {
    // Malformed/missing - fall through to the "all" default below.
  }
  return { mode: "all" };
}
function setCompanyFilter(filter) {
  localStorage.setItem(COMPANY_FILTER_KEY, JSON.stringify(filter));
}
/** Every company currently in scope for viewing - all of them by default. */
function filteredCompanies() {
  const filter = getCompanyFilter();
  return filter.mode === "all" ? db.companies : db.companies.filter((c) => filter.ids.includes(c.id));
}
function filteredCompanyIds() {
  return filteredCompanies().map((c) => c.id);
}
function isCompanyInFilter(companyId) {
  const filter = getCompanyFilter();
  return filter.mode === "all" || filter.ids.includes(companyId);
}
function companyFilterLabel() {
  const filter = getCompanyFilter();
  if (filter.mode === "all") return "All Companies";
  const names = filter.ids.map((id) => db.companies.find((c) => c.id === id)).filter(Boolean).map((c) => c.name);
  if (names.length === 0) return "No Companies Selected";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(", ");
  return `${names[0]} +${names.length - 1} more`;
}

// Whether the filter panel is open, remembered across re-renders of this
// control (e.g. triggered by renderContent() below as the user ticks
// boxes) so it doesn't visually snap shut after every single click -
// previously `draw()` re-ran on every checkbox change and threw away the
// whole panel's DOM, so the bubbling "click" from that same checkbox then
// landed on an orphaned (just-replaced) node, which the document-level
// outside-click handler below couldn't find inside the new panel and so
// closed it immediately. Now a checkbox change only patches the specific
// bits that need to change (the button label, checkbox states) and calls
// the lighter renderContent() instead of a full route(), so the panel's
// own DOM is never torn down while it's open - you can tick company A,
// then company B, then company C without it closing in between.
let companyFilterPanelOpen = false;

function renderCompanyFilterControl() {
  const el = document.getElementById("company-filter");
  if (!el) return;
  if (db.companies.length <= 1) {
    el.innerHTML = "";
    return;
  }

  function applyFilterChange(filter) {
    setCompanyFilter(filter);
    const resolved = getCompanyFilter();
    const btn = document.getElementById("company-filter-btn");
    if (btn) btn.innerHTML = `&#128065; ${escapeHtml(companyFilterLabel())} &#9662;`;
    const allCb = document.getElementById("company-filter-all");
    if (allCb) allCb.checked = resolved.mode === "all";
    renderContent();
  }

  function draw() {
    const filter = getCompanyFilter();
    const selectedIds = filteredCompanyIds();
    el.innerHTML = `
      <div style="position:relative;display:inline-block;">
        <button type="button" id="company-filter-btn" title="Which companies' data to show in lists and reports">&#128065; ${escapeHtml(companyFilterLabel())} &#9662;</button>
        <div id="company-filter-panel" class="card" style="display:${companyFilterPanelOpen ? "block" : "none"};position:absolute;right:0;top:calc(100% + 4px);z-index:100;min-width:240px;max-height:320px;overflow-y:auto;">
          <label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" id="company-filter-all" ${filter.mode === "all" ? "checked" : ""} /><strong>All Companies</strong></label>
          <p class="text-muted" style="font-size:11px;margin:2px 0 0;">Click again to clear every selection.</p>
          <hr style="border-color:var(--line);margin:8px 0;" />
          ${db.companies.map((c) => `<label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" class="company-filter-item" value="${c.id}" ${selectedIds.includes(c.id) ? "checked" : ""} /> ${escapeHtml(c.name)}</label>`).join("")}
        </div>
      </div>
    `;
    document.getElementById("company-filter-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      companyFilterPanelOpen = !companyFilterPanelOpen;
      document.getElementById("company-filter-panel").style.display = companyFilterPanelOpen ? "block" : "none";
    });
    document.getElementById("company-filter-all").addEventListener("change", (e) => {
      const checked = e.target.checked;
      applyFilterChange(checked ? { mode: "all" } : { mode: "selected", ids: [] });
      el.querySelectorAll(".company-filter-item").forEach((cb) => { cb.checked = checked; });
    });
    el.querySelectorAll(".company-filter-item").forEach((cb) => {
      cb.addEventListener("change", () => {
        const next = new Set(filteredCompanyIds());
        if (cb.checked) next.add(cb.value);
        else next.delete(cb.value);
        applyFilterChange(next.size === db.companies.length ? { mode: "all" } : { mode: "selected", ids: [...next] });
      });
    });
  }
  draw();
}
document.addEventListener("click", (e) => {
  const panel = document.getElementById("company-filter-panel");
  if (panel && panel.style.display === "block" && !panel.contains(e.target) && e.target.id !== "company-filter-btn") {
    panel.style.display = "none";
    companyFilterPanelOpen = false;
  }
});

function updateBackupStatus(justAutoSaved) {
  const el = document.getElementById("backup-status");
  if (!el) return;
  if (justAutoSaved) {
    el.textContent = `Auto-saved ${new Date().toLocaleTimeString()}`;
    el.className = "text-good";
  } else {
    el.textContent = "Saved in browser only";
    el.className = "text-muted";
  }
}

const SIDEBAR = [
  { section: "Overview", items: [["dashboard", "Dashboard"]] },
  {
    section: "Payroll",
    items: [
      ["employees", "Employees"],
      ["salary-structures", "Salary Structures"],
      ["investment-declarations", "Investment Declarations"],
      ["previous-employer", "Previous Employer Income"],
      ["payroll-runs", "Payroll Runs"],
      ["salary-register", "Salary Register"],
      ["salary-slips", "Salary Slips"],
      ["bank-files", "Bank Payment Files"],
      ["import", "Import Wizard"],
    ],
  },
  { section: "Insights", items: [["reports", "Reports"], ["reconciliation", "Reconciliation"], ["audit-log", "Audit Log"]] },
  {
    section: "Setup",
    items: [
      ["companies", "Companies"],
      ["salary-templates", "Salary Structure Templates"],
      ["tax-rules", "Tax Rules"],
      ["pt-slabs", "PT Slabs"],
      ["backup", "Backup & Restore"],
    ],
  },
];

function renderSidebar(activePath) {
  const parts = [`<div class="brand">Payroll Register</div>`];
  for (const group of SIDEBAR) {
    parts.push(`<div class="section-label">${group.section}</div>`);
    for (const [path, label] of group.items) {
      const cls = path === activePath ? "active" : "";
      parts.push(`<a href="#/${path}" class="${cls}">${label}</a>`);
    }
  }
  return parts.join("\n");
}

function currentTheme() {
  return localStorage.getItem("theme") || "dark";
}
function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("theme", theme);
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
}
function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}

/** Re-renders just the current page's content (not the sidebar or the company filter control itself) - used after a company-filter change so the filter panel's own DOM is never torn down while the user has it open. */
function renderContent() {
  const hash = location.hash.replace(/^#\/?/, "") || "dashboard";
  const segments = hash.split("/");
  const container = document.getElementById("content");
  container.innerHTML = "";

  if (segments.length > 1 && DYNAMIC_ROUTES[segments[0]]) {
    document.getElementById("page-title").textContent = Views[segments[0]] ? Views[segments[0]].label : segments[0];
    DYNAMIC_ROUTES[segments[0]](container, segments.slice(1));
    return;
  }
  const view = Views[segments[0]] || Views["dashboard"];
  document.getElementById("page-title").textContent = view.label;
  view.render(container);
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "") || "dashboard";
  const segments = hash.split("/");
  document.getElementById("sidebar").innerHTML = renderSidebar(segments[0]);
  renderCompanyFilterControl();
  renderContent();
}

function navigate(path) {
  location.hash = `#/${path}`;
}

// --- Dashboard charts ----------------------------------------------------
// Dark-mode categorical pair (blue/orange) independently re-validated for
// CVD separation + contrast against THIS app's actual surfaces (the raw
// --teal/--clay tokens share too close a lightness band to pass as a
// categorical pair - see scripts/validate_palette.js from the dataviz
// skill); the single-series trend chart instead reuses the app's own
// --gold brand teal, so it reads as this app's chart rather than a
// foreign component.
const CHART_COLORS = {
  trend: { dark: "#1fd6a8", light: "#0b7a70" },
  info: { dark: "#3987e5", light: "#2a78d6" },
  oldRegime: { dark: "#3987e5", light: "#2a78d6" },
  newRegime: { dark: "#d95926", light: "#eb6834" },
};
function chartColor(key) {
  return currentTheme() === "light" ? CHART_COLORS[key].light : CHART_COLORS[key].dark;
}

/** "Nice" (1/2/5 x 10^n) number for an axis max/step - Paul Heckbert's classic algorithm, so gridlines land on round values instead of odd fractions. */
function niceNumber(range, round) {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * Math.pow(10, exponent);
}
/** Axis ceiling with ~15% headroom above the data (so a peak never touches the card edge) + an evenly-spaced nice step. */
function niceAxisScale(maxVal, targetSteps) {
  if (!(maxVal > 0)) return { max: targetSteps, step: 1 };
  const headroomRange = niceNumber(maxVal * 1.15, false);
  const step = niceNumber(headroomRange / targetSteps, true);
  return { max: Math.ceil(headroomRange / step) * step, step };
}
/** Compact Rs formatting for axis ticks/tooltips on large payroll figures - Cr/L/K, same convention as common Indian finance UI. */
function compactRupees(n) {
  const abs = Math.abs(n);
  const fmt = (v, suffix) => `₹${(Math.round(v * 10) / 10).toLocaleString("en-IN")}${suffix}`;
  if (abs >= 1e7) return fmt(n / 1e7, "Cr");
  if (abs >= 1e5) return fmt(n / 1e5, "L");
  if (abs >= 1e3) return fmt(n / 1e3, "K");
  return rupees(n);
}
/** Uniform Catmull-Rom -> cubic Bezier conversion (tension 0) - the standard construction for a smooth curve that still passes exactly through every data point (unlike a generic spline that can drift off them). */
function smoothPathD(pts) {
  if (pts.length < 2) return "";
  const d = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

/**
 * Smooth area/line trend chart for a single series (e.g. monthly payroll
 * cost) - mirrors the "trend over time, single series" form: one hue, a
 * soft gradient wash under the line (never a saturated block), labelled
 * gridlines, and a hover crosshair+tooltip per point (wired up by
 * wireTrendChartHover, called after this HTML is inserted into the DOM).
 */
function renderTrendChart(points, { chartId, color }) {
  const W = 640, H = 230, padLeft = 54, padRight = 14, padTop = 16, padBottom = 34;
  const plotW = W - padLeft - padRight, plotH = H - padTop - padBottom;
  const plotBottom = padTop + plotH;
  const values = points.map((p) => p.value);
  const { max, step } = niceAxisScale(Math.max(...values, 0), 5);
  const xAt = (i) => (points.length === 1 ? padLeft + plotW / 2 : padLeft + (i / (points.length - 1)) * plotW);
  const yAt = (v) => plotBottom - (v / max) * plotH;
  const pts = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));
  const lineD = smoothPathD(pts);
  const areaD = `${lineD} L ${pts[pts.length - 1].x} ${plotBottom} L ${pts[0].x} ${plotBottom} Z`;

  const gridLines = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = yAt(v);
    gridLines.push(`<line x1="${padLeft}" y1="${y}" x2="${W - padRight}" y2="${y}" stroke="var(--line)" stroke-width="1" />`);
    gridLines.push(`<text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--ivory-dim)">${compactRupees(v)}</text>`);
  }
  const xLabels = points.map((p, i) => `<text x="${xAt(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--ivory-dim)">${escapeHtml(p.label)}</text>`).join("");
  // Wider, invisible hit-targets (per the dataviz skill's interaction spec: hit
  // target bigger than the mark) carry the hover - the visible marker is
  // drawn/positioned by JS only on the hovered point, not one per point.
  const hitTargets = pts.map((pt, i) => `<circle class="trend-hit" data-i="${i}" cx="${pt.x}" cy="${pt.y}" r="14" fill="transparent" />`).join("");
  const last = pts[pts.length - 1];

  return `
    <div class="chart-wrap" data-chart="${chartId}" style="position:relative;">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="${chartId}-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.22" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${gridLines.join("")}
        ${xLabels}
        <path d="${areaD}" fill="url(#${chartId}-grad)" stroke="none" />
        <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${last.x}" cy="${last.y}" r="4" fill="${color}" stroke="var(--ink-3)" stroke-width="2" />
        <g class="trend-hover-marker" style="display:none;"><circle r="4" fill="${color}" stroke="var(--ink-3)" stroke-width="2" /></g>
        <line class="trend-hover-line" x1="0" y1="${padTop}" x2="0" y2="${plotBottom}" stroke="var(--ivory-dim)" stroke-width="1" style="display:none;" />
        ${hitTargets}
      </svg>
      <div class="chart-tooltip" style="position:absolute;display:none;pointer-events:none;background:var(--ink-2);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:12px;white-space:nowrap;transform:translate(-50%,-110%);z-index:5;"></div>
    </div>
  `;
}
/** Attaches the hover crosshair+tooltip for a renderTrendChart - call once after the returned HTML is in the DOM. `points` must be the same array passed to renderTrendChart. */
function wireTrendChartHover(container, chartId, points, formatValue) {
  const wrap = container.querySelector(`.chart-wrap[data-chart="${chartId}"]`);
  if (!wrap) return;
  const svg = wrap.querySelector("svg");
  const tooltip = wrap.querySelector(".chart-tooltip");
  const hoverMarker = wrap.querySelector(".trend-hover-marker");
  const hoverLine = wrap.querySelector(".trend-hover-line");
  wrap.querySelectorAll(".trend-hit").forEach((hit) => {
    hit.addEventListener("mouseenter", () => {
      const i = Number(hit.dataset.i);
      const cx = hit.getAttribute("cx"), cy = hit.getAttribute("cy");
      hoverMarker.style.display = "";
      hoverMarker.querySelector("circle").setAttribute("cx", cx);
      hoverMarker.querySelector("circle").setAttribute("cy", cy);
      hoverLine.style.display = "";
      hoverLine.setAttribute("x1", cx);
      hoverLine.setAttribute("x2", cx);
      const svgRect = svg.getBoundingClientRect();
      const scale = svgRect.width / svg.viewBox.baseVal.width;
      tooltip.style.left = `${Number(cx) * scale}px`;
      tooltip.style.top = `${Number(cy) * scale}px`;
      tooltip.innerHTML = `<strong>${escapeHtml(points[i].label)}</strong><br/>${formatValue(points[i].value)}`;
      tooltip.style.display = "block";
    });
    hit.addEventListener("mouseleave", () => {
      hoverMarker.style.display = "none";
      hoverLine.style.display = "none";
      tooltip.style.display = "none";
    });
  });
}

/**
 * Part-to-whole split (e.g. Old vs New regime headcount) as a single
 * stacked bar with a 2px surface gap between segments (the dataviz skill's
 * spacer mechanism for telling touching segments apart) - plus a legend
 * with counts/percentages, since 2 categorical series always need one
 * (never rely on color-matching alone), and labels inside each segment
 * when they fit.
 */
function renderSplitBarChart(segments) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return `<p class="text-muted">No active employees yet.</p>`;
  const gap = 2;
  let x = 0;
  const W = 640, H = 28;
  const bars = segments
    .map((seg) => {
      const w = Math.max(0, (seg.value / total) * W - gap);
      const rect = seg.value > 0 ? `<rect x="${x}" y="0" width="${w}" height="${H}" rx="4" fill="${seg.color}" />` : "";
      const pct = Math.round((seg.value / total) * 100);
      const label = w > 46 ? `<text x="${x + w / 2}" y="${H / 2 + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--on-accent)">${seg.value} (${pct}%)</text>` : "";
      x += w + gap;
      return rect + label;
    })
    .join("");
  const legend = segments
    .map((seg) => {
      const pct = total ? Math.round((seg.value / total) * 100) : 0;
      return `<div class="row gap-8" style="align-items:center;"><span style="width:10px;height:10px;border-radius:3px;background:${seg.color};display:inline-block;"></span><span>${escapeHtml(seg.label)}: <strong>${seg.value}</strong> (${pct}%)</span></div>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;">${bars}</svg>
    <div class="row gap-16 mt-16" style="flex-wrap:wrap;">${legend}</div>
  `;
}

// Simple 24x24 line icons (stroke=currentColor, so the hero card's own
// color sets both the chip tint and the icon stroke) - kept to the same
// handful used across the Dashboard's hero cards, not a general icon set.
const HERO_ICONS = {
  rupee: `<span style="font-size:20px;font-weight:700;line-height:1;">₹</span>`,
  payslip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>`,
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
};
/**
 * Headline-KPI "hero" card: icon chip + big sans value + an optional
 * colored context/delta line with a direction arrow - the Dashboard's
 * replacement for a plain stat tile where the number has a story (a
 * trend, a count, a call to action) worth surfacing at a glance.
 */
function renderHeroCard({ icon, color, label, value, sub, href }) {
  const body = `
    <div class="hero-icon" style="background:color-mix(in srgb, ${color} 18%, transparent); color:${color};">${icon}</div>
    <div class="hero-label">${label}</div>
    <div class="hero-value">${value}</div>
    ${sub ? `<div class="hero-sub" style="color:${color};">${sub} <span aria-hidden="true">&#8599;</span></div>` : ""}
  `;
  return href ? `<a class="hero-card" href="${href}">${body}</a>` : `<div class="hero-card">${body}</div>`;
}

// --- Dashboard ---------------------------------------------------------
registerView("dashboard", "Overview", "Dashboard", (container) => {
  if (db.companies.length === 0) {
    container.innerHTML = `<div class="card"><p class="text-muted">No company set up yet. <a href="#/companies/new">Add your first company</a> to get started.</p></div>`;
    return;
  }
  const viewCompanyIds = filteredCompanyIds();
  const companyEmployees = db.employees.filter((e) => viewCompanyIds.includes(e.companyId));
  const activeEmployees = companyEmployees.filter((e) => e.status !== "INACTIVE").length;
  const currentFy = db.financialYears.find((f) => f.isCurrent) || db.financialYears[0];
  const runsThisFy = currentFy ? db.payrollRuns.filter((r) => r.financialYearId === currentFy.id && viewCompanyIds.includes(r.companyId)) : [];
  // "Latest" only makes unambiguous sense within one company when several
  // are in view (different entities' payroll calendars needn't line up) -
  // pick the most recently processed run overall, labeled with its company.
  const latestRun = runsThisFy.slice().sort((a, b) => new Date(b.processedAt || 0) - new Date(a.processedAt || 0) || b.payrollMonthIndex - a.payrollMonthIndex)[0];
  const latestNet = latestRun ? latestRun.lines.reduce((s, l) => s + l.netSalary, 0) : 0;
  const latestRunCompany = latestRun ? db.companies.find((c) => c.id === latestRun.companyId) : null;
  const pendingDeclarations = currentFy
    ? companyEmployees.filter((e) => e.status !== "INACTIVE" && !db.investmentDeclarations.some((d) => d.employeeId === e.id && d.financialYearId === currentFy.id)).length
    : 0;
  // Nudge only - see PayrollEngine.regimeSuggestion. Never changes what
  // TDS actually gets withheld; just flags employees worth a second look.
  const regimeSuggestionCount = currentFy
    ? companyEmployees.filter((e) => e.status !== "INACTIVE" && PayrollEngine.regimeSuggestion(db, e.id, currentFy.id)).length
    : 0;

  // Monthly payroll cost (gross + employer contributions - the actual
  // business expense, not just employee take-home) across every processed
  // run this FY, in calendar order - the trend chart below. Grouped by
  // calendar month (not one point per run record): more than one run can
  // share a month - multiple payroll groups processed separately, or
  // several companies in view at once - and those must be SUMMED into one
  // point per month, not plotted as repeated same-month points (which
  // produced a nonsensical "6x Apr" x-axis when 6 runs existed for April).
  const costByMonthIndex = new Map();
  for (const r of runsThisFy) {
    if (r.lines.length === 0) continue;
    const cost = r.lines.reduce((s, l) => s + l.totalEmployerCost, 0);
    costByMonthIndex.set(r.payrollMonthIndex, (costByMonthIndex.get(r.payrollMonthIndex) || 0) + cost);
  }
  const costTrendPoints = [...costByMonthIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([monthIndex, value]) => ({ label: FY_MONTH_NAMES[monthIndex - 1].slice(0, 3), value }));
  // A single month has nothing to trend against - the "Monthly Payroll
  // Cost" hero card above already shows that one figure; a one-point
  // chart (or the dataviz skill's own advice: never a one-bar bar chart)
  // would just repeat it less clearly. The chart earns its place only
  // once there's a second month to compare against.
  const showCostTrendChart = costTrendPoints.length >= 2;

  const activeEmployeeList = companyEmployees.filter((e) => e.status !== "INACTIVE");
  const oldRegimeCount = activeEmployeeList.filter((e) => e.taxRegime === "OLD").length;
  const newRegimeCount = activeEmployeeList.length - oldRegimeCount;

  const latestCostPoint = costTrendPoints[costTrendPoints.length - 1];
  const priorCostPoint = costTrendPoints[costTrendPoints.length - 2];
  let costDeltaSub = null;
  if (latestCostPoint && priorCostPoint && priorCostPoint.value > 0) {
    const pctChange = ((latestCostPoint.value - priorCostPoint.value) / priorCostPoint.value) * 100;
    costDeltaSub = `${pctChange >= 0 ? "+" : ""}${Math.round(pctChange * 10) / 10}% vs ${priorCostPoint.label}`;
  }

  const heroCards = [
    latestCostPoint
      ? renderHeroCard({
          icon: HERO_ICONS.rupee, color: chartColor("trend"), label: "Monthly Payroll Cost",
          value: compactRupees(latestCostPoint.value),
          sub: costDeltaSub, href: "#/payroll-runs",
        })
      : null,
    latestRun
      ? renderHeroCard({
          icon: HERO_ICONS.payslip, color: chartColor("info"), label: `Latest Net Pay${latestRunCompany && viewCompanyIds.length > 1 ? ` (${escapeHtml(latestRunCompany.name)})` : ""}`,
          value: compactRupees(latestNet),
          sub: `${latestRun.lines.length} employee${latestRun.lines.length === 1 ? "" : "s"}`, href: `#/payroll-runs/${latestRun.id}`,
        })
      : null,
    renderHeroCard({
      icon: HERO_ICONS.document, color: pendingDeclarations > 0 ? "var(--clay)" : "var(--good)", label: "Pending Investment Declarations",
      value: String(pendingDeclarations),
      sub: pendingDeclarations > 0 ? "Review now" : "All filed", href: "#/employees",
    }),
    renderHeroCard({
      icon: HERO_ICONS.clock, color: regimeSuggestionCount > 0 ? "var(--bad-text)" : "var(--good)", label: "Could Save by Switching Regime",
      value: String(regimeSuggestionCount),
      sub: regimeSuggestionCount > 0 ? "Needs review" : "All optimal", href: "#/employees",
    }),
  ].filter(Boolean).join("");

  container.innerHTML = `
    <p class="text-muted">FY ${currentFy ? currentFy.code : "-"} · ${activeEmployees} active employee${activeEmployees === 1 ? "" : "s"}${viewCompanyIds.length > 1 ? ` (${escapeHtml(companyFilterLabel())})` : ""}</p>
    <div class="hero-card-grid">${heroCards}</div>
    ${
      showCostTrendChart
        ? `<div class="card">
      <h3>Payroll Cost Trend</h3>
      <p class="text-muted" style="font-size:12px;">Monthly payroll cost (gross salary + employer contributions)${viewCompanyIds.length > 1 ? ` - ${escapeHtml(companyFilterLabel())}` : ""}, FY ${currentFy.code}.</p>
      ${renderTrendChart(costTrendPoints, { chartId: "payroll-cost-trend", color: chartColor("trend") })}
    </div>`
        : ""
    }
    ${
      activeEmployeeList.length > 0
        ? `<div class="card">
      <h3>Regime Split</h3>
      <p class="text-muted" style="font-size:12px;">Active employees${viewCompanyIds.length > 1 ? ` (${companyFilterLabel()})` : ""} by tax regime.</p>
      ${renderSplitBarChart([
        { label: "Old Regime", value: oldRegimeCount, color: chartColor("oldRegime") },
        { label: "New Regime", value: newRegimeCount, color: chartColor("newRegime") },
      ])}
    </div>`
        : ""
    }
    <div class="card">
      <h3>Getting started</h3>
      <p class="text-muted">Add employees, define their salary structure, and process a monthly payroll run from the sidebar - each "New"/"Create" form has its own Legal Entity field for a multi-company setup. The eye icon at the top controls which compan${db.companies.length > 1 ? "ies you're viewing here" : "y you're viewing"}. <a href="#/backup">Backup &amp; Restore</a> keeps your data safe - this app stores everything locally in your browser.</p>
    </div>
  `;
  if (showCostTrendChart) wireTrendChartHover(container, "payroll-cost-trend", costTrendPoints, (v) => rupees(v));
});

// --- Tax Rules (read-only viewer) --------------------------------------
// Percentages stored as fractions (e.g. 0.14) can print as
// "14.000000000000002%" due to ordinary floating-point binary rounding
// (0.14 has no exact binary representation) - round to 2dp for display only;
// the underlying stored/calculated value is untouched.
function pct(n) {
  return `${Math.round(n * 10000) / 100}%`;
}

registerView("tax-rules", "Setup", "Tax Rules", (container) => {
  let expandedId = null;
  let editingId = null;

  function render() {
    const rows = db.taxRuleSets
      .map(
        (r) => `
        <tr>
          <td>${r.financialYearCode}</td>
          <td>${sentenceCase(r.regime)}</td>
          <td>${formatDateDisplay(r.effectiveFrom)}</td>
          <td>${rupees(r.standardDeduction)}</td>
          <td>${pct(r.cessRate)}</td>
          <td>${pct(r.npsEmployerCapPercent)}</td>
          <td>${r.notes ? `<span class="badge neutral">${escapeHtml(r.notes.slice(0, 60))}${r.notes.length > 60 ? "..." : ""}</span>` : ""}</td>
          <td class="row gap-8">
            <button data-id="${r.id}" class="toggle-rule-detail">${expandedId === r.id ? "Hide" : "View full logic"}</button>
            <button data-id="${r.id}" class="toggle-rule-edit">${editingId === r.id ? "Cancel Edit" : "Edit"}</button>
          </td>
        </tr>
        ${editingId === r.id ? `<tr><td colspan="8">${renderRuleEditForm(r)}</td></tr>` : expandedId === r.id ? `<tr><td colspan="8">${renderRuleDetail(r)}</td></tr>` : ""}`,
      )
      .join("");
    container.innerHTML = `
      <div class="card">
        <h3>TDS Calculation Method</h3>
        <p class="text-muted" style="font-size:12px;">The default "Standard" method spreads the remaining tax balance evenly over the remaining months of the FY every month. "Proportional" instead ties a specific month's TDS to how much of the employee's annual income has actually been paid out so far (total tax liability &divide; total annual gross &times; gross paid to date, less TDS already deducted) - applied automatically ONLY in a month where a Bonus or Arrears is paid, or an employee's joining month (where the standard method's even monthly split can badly over- or under-deduct against that month's own small actual pay). Every other month is unaffected either way.</p>
        <label class="row gap-8" style="display:flex;align-items:center;">
          <input type="checkbox" id="use-proportional-tds" ${db.payrollSettings && db.payrollSettings.useProportionalTdsForVariablePay ? "checked" : ""} />
          Use the Proportional method for Bonus/Arrears/joining months (otherwise always Standard)
        </label>
      </div>
      <div class="card">
        <p class="text-muted">These are the tax parameters built into the app for each financial year and regime - every slab, rebate, surcharge, deduction cap and HRA percentage the engine actually uses. Click "View full logic" to see everything behind a FY/regime's calculation, or "Edit" to change it when the law changes.</p>
        <p class="text-muted" style="font-size:12px;"><strong>Correcting a mistake</strong> (e.g. the provisional FY 2027-28 placeholder, once that year's real Budget is out)? Edit the rule set in place. <strong>A genuine mid-year law change?</strong> Use "Clone as new rule set" (inside Edit) with a later Effective From date instead - the engine always uses the latest rule set effective on or before the month being calculated, so earlier months keep using the old rule and nothing already paid/locked is retroactively affected.</p>
        <table>
          <thead><tr><th>FY</th><th>Regime</th><th>Effective From</th><th>Standard Deduction</th><th>Cess</th><th>Employer NPS Cap</th><th>Notes</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    wireDateFields(container);
    document.getElementById("use-proportional-tds").addEventListener("change", async (e) => {
      if (!db.payrollSettings) db.payrollSettings = {};
      db.payrollSettings.useProportionalTdsForVariablePay = e.target.checked;
      await persist();
    });
    container.querySelectorAll(".toggle-rule-detail").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        expandedId = expandedId === id ? null : id;
        render();
      });
    });
    container.querySelectorAll(".toggle-rule-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        editingId = editingId === id ? null : id;
        expandedId = null;
        render();
      });
    });

    const editForm = container.querySelector("#rule-edit-form");
    if (editForm) {
      const r = db.taxRuleSets.find((x) => x.id === editForm.dataset.id);

      container.querySelectorAll(".remove-slab").forEach((btn) =>
        btn.addEventListener("click", async () => {
          r.slabs.splice(Number(btn.dataset.idx), 1);
          await persist();
          render();
        }),
      );
      document.getElementById("btn-add-slab").addEventListener("click", async () => {
        const ageCategory = document.getElementById("add-slab-age").value;
        r.slabs.push({ minIncome: 0, maxIncome: null, rate: 0, order: r.slabs.length + 1, ageCategory });
        await persist();
        render();
      });
      container.querySelectorAll(".remove-surcharge").forEach((btn) =>
        btn.addEventListener("click", async () => {
          r.surchargeConfig.splice(Number(btn.dataset.idx), 1);
          await persist();
          render();
        }),
      );
      document.getElementById("btn-add-surcharge").addEventListener("click", async () => {
        r.surchargeConfig.push({ threshold: 0, rate: 0 });
        await persist();
        render();
      });

      document.getElementById("btn-clone-rule").addEventListener("click", async () => {
        const clone = JSON.parse(JSON.stringify(r));
        clone.id = newId("trs");
        const original = new Date(r.effectiveFrom);
        original.setDate(original.getDate() + 1);
        clone.effectiveFrom = original.toISOString();
        clone.notes = `Cloned from a rule set effective ${formatDateDisplay(r.effectiveFrom)} - set the correct Effective From date for this amendment, then Save.`;
        db.taxRuleSets.push(clone);
        await persist();
        editingId = clone.id;
        render();
      });

      editForm.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        const fd = new FormData(evt.target);
        const errorEl = document.getElementById("rule-edit-error");
        errorEl.textContent = "";
        try {
          r.effectiveFrom = new Date(String(fd.get("effectiveFrom"))).toISOString();
          r.standardDeduction = num(fd.get("standardDeduction"));
          r.cessRate = num(fd.get("cessRate")) / 100;
          r.npsEmployerCapPercent = num(fd.get("npsEmployerCapPercent")) / 100;
          r.employerNpsPfPerqLimit = num(fd.get("employerNpsPfPerqLimit"));
          r.rebateLimitOld = num(fd.get("rebateLimitOld"));
          r.rebateMaxOld = num(fd.get("rebateMaxOld"));
          r.rebateLimitNew = num(fd.get("rebateLimitNew"));
          r.marginalReliefNew = fd.get("marginalReliefNew") === "on";
          r.hraConfig.metroPercent = num(fd.get("hraMetroPercent")) / 100;
          r.hraConfig.nonMetroPercent = num(fd.get("hraNonMetroPercent")) / 100;
          r.notes = String(fd.get("notes") || "") || null;

          container.querySelectorAll(".slab-min").forEach((el) => (r.slabs[Number(el.dataset.idx)].minIncome = num(el.value)));
          container.querySelectorAll(".slab-max").forEach((el) => (r.slabs[Number(el.dataset.idx)].maxIncome = el.value === "" ? null : num(el.value)));
          container.querySelectorAll(".slab-rate").forEach((el) => (r.slabs[Number(el.dataset.idx)].rate = num(el.value) / 100));
          container.querySelectorAll(".surcharge-threshold").forEach((el) => (r.surchargeConfig[Number(el.dataset.idx)].threshold = num(el.value)));
          container.querySelectorAll(".surcharge-rate").forEach((el) => (r.surchargeConfig[Number(el.dataset.idx)].rate = num(el.value) / 100));
          container.querySelectorAll(".deduction-limit").forEach((el) => (r.deductionLimits[el.dataset.key] = num(el.value)));

          await persist();
          editingId = null;
          render();
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    }
  }

  function renderRuleEditForm(r) {
    const slabRows = r.slabs
      .map(
        (s, i) => `
        <tr>
          <td>${sentenceCase(s.ageCategory)}</td>
          <td><input type="number" min="0" class="slab-min" data-idx="${i}" value="${s.minIncome}" /></td>
          <td><input type="number" min="0" class="slab-max" data-idx="${i}" value="${s.maxIncome ?? ""}" placeholder="(no limit)" /></td>
          <td><input type="number" min="0" step="0.01" class="slab-rate" data-idx="${i}" value="${s.rate * 100}" /> %</td>
          <td><button type="button" class="danger remove-slab" data-idx="${i}">Remove</button></td>
        </tr>`,
      )
      .join("");

    const surchargeRows = r.surchargeConfig
      .map(
        (s, i) => `
        <tr>
          <td><input type="number" min="0" class="surcharge-threshold" data-idx="${i}" value="${s.threshold}" /></td>
          <td><input type="number" min="0" step="0.01" class="surcharge-rate" data-idx="${i}" value="${s.rate * 100}" /> %</td>
          <td><button type="button" class="danger remove-surcharge" data-idx="${i}">Remove</button></td>
        </tr>`,
      )
      .join("");

    const deductionRows = Object.entries(r.deductionLimits)
      .map(([k, v]) => `<tr><td>${sentenceCase(k)}</td><td><input type="number" min="0" class="deduction-limit" data-key="${k}" value="${v}" /></td></tr>`)
      .join("");

    return `
      <div class="card" style="margin:8px 0;">
        <h3>Editing ${r.financialYearCode} - ${sentenceCase(r.regime)} regime</h3>
        <form id="rule-edit-form" data-id="${r.id}">
          <div class="form-grid">
            <div><label>Effective From</label>${dateField("effectiveFrom", r.effectiveFrom.slice(0, 10))}</div>
            <div><label>Standard Deduction</label><input type="number" min="0" name="standardDeduction" value="${r.standardDeduction}" /></div>
            <div><label>Cess Rate (%)</label><input type="number" min="0" step="0.01" name="cessRate" value="${r.cessRate * 100}" /></div>
            <div><label>Employer NPS Cap (% of Basic+DA)</label><input type="number" min="0" step="0.01" name="npsEmployerCapPercent" value="${r.npsEmployerCapPercent * 100}" /></div>
            <div><label>Employer PF+NPS+Superannuation Perquisite Threshold</label><input type="number" min="0" name="employerNpsPfPerqLimit" value="${r.employerNpsPfPerqLimit}" /></div>
            <div><label>Rebate Limit (Old Regime)</label><input type="number" min="0" name="rebateLimitOld" value="${r.rebateLimitOld}" /></div>
            <div><label>Rebate Max Amount (Old Regime)</label><input type="number" min="0" name="rebateMaxOld" value="${r.rebateMaxOld}" /></div>
            <div><label>Rebate Limit (New Regime)</label><input type="number" min="0" name="rebateLimitNew" value="${r.rebateLimitNew}" /></div>
            <div style="display:flex;align-items:flex-end;"><label class="row gap-8" style="display:flex;align-items:center;"><input type="checkbox" name="marginalReliefNew" ${r.marginalReliefNew ? "checked" : ""} style="width:auto;" /> Marginal relief (New Regime)</label></div>
            <div><label>HRA % (Metro)</label><input type="number" min="0" step="0.01" name="hraMetroPercent" value="${r.hraConfig.metroPercent * 100}" /></div>
            <div><label>HRA % (Non-Metro)</label><input type="number" min="0" step="0.01" name="hraNonMetroPercent" value="${r.hraConfig.nonMetroPercent * 100}" /></div>
          </div>
          <div><label class="mt-16">Notes</label><textarea name="notes" rows="2" style="width:100%;">${escapeHtml(r.notes || "")}</textarea></div>

          <h3 class="mt-16">Income Slabs</h3>
          <table><thead><tr><th>Age Category</th><th>Min Income</th><th>Max Income</th><th>Rate</th><th></th></tr></thead><tbody id="slab-rows">${slabRows}</tbody></table>
          <div class="row gap-8 mt-16">
            <select id="add-slab-age">
              <option value="BELOW_60">BELOW 60</option>
              <option value="SENIOR_60_79">SENIOR 60-79</option>
              <option value="SUPER_SENIOR_80_PLUS">SUPER SENIOR 80+</option>
            </select>
            <button type="button" id="btn-add-slab">+ Add Slab Row</button>
          </div>

          <h3 class="mt-16">Surcharge</h3>
          <table><thead><tr><th>Threshold</th><th>Rate</th><th></th></tr></thead><tbody id="surcharge-rows">${surchargeRows}</tbody></table>
          <div class="row gap-8 mt-16"><button type="button" id="btn-add-surcharge">+ Add Surcharge Row</button></div>

          <h3 class="mt-16">Deduction &amp; Exemption Limits</h3>
          <table><thead><tr><th>Item</th><th>Limit</th></tr></thead><tbody>${deductionRows}</tbody></table>

          <p class="text-muted mt-16" style="font-size:12px;">Note: edits here never change already-calculated payroll lines (their tax snapshot is frozen at calculation time) - only future (re)calculations use the new values. The "Full Rule Catalog" reference text in "View full logic" may not reflect an edit until you reopen it; the figures and tables on this edit screen are always current.</p>

          <div id="rule-edit-error" class="text-bad mt-16"></div>
          <div class="row gap-8 mt-16">
            <button type="submit" class="primary">Save</button>
            <button type="button" id="btn-clone-rule">Clone as New Rule Set</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderRuleDetail(r) {
    const byAge = new Map();
    for (const slab of r.slabs) {
      if (!byAge.has(slab.ageCategory)) byAge.set(slab.ageCategory, []);
      byAge.get(slab.ageCategory).push(slab);
    }
    const slabsHtml = [...byAge.entries()]
      .map(
        ([age, slabs]) => `
        <div class="mt-16">
          <strong>${sentenceCase(age)}</strong>
          <table>
            <thead><tr><th>Income Band</th><th>Rate</th></tr></thead>
            <tbody>${slabs
              .sort((a, b) => a.order - b.order)
              .map((s) => `<tr><td>${rupees(s.minIncome)} - ${s.maxIncome == null ? "and above" : rupees(s.maxIncome)}</td><td>${pct(s.rate)}</td></tr>`)
              .join("")}</tbody>
          </table>
        </div>`,
      )
      .join("");

    const surchargeRows = r.surchargeConfig
      .slice()
      .sort((a, b) => b.threshold - a.threshold)
      .map((s) => `<tr><td>Taxable income &gt; ${rupees(s.threshold)}</td><td>${pct(s.rate)}</td></tr>`)
      .join("");

    const deductionRows = Object.entries(r.deductionLimits)
      .map(([k, v]) => `<tr><td>${sentenceCase(k)}</td><td>${rupees(v)}</td></tr>`)
      .join("");

    const rulesRows = r.rules
      .map(
        (rule) => `
        <tr>
          <td>${escapeHtml(rule.name)}</td>
          <td>${escapeHtml(rule.section)}</td>
          <td>${escapeHtml(rule.calculationMethod)}</td>
          <td>${rule.limitValue != null ? rupees(rule.limitValue) : "-"}</td>
          <td>${rule.rateValue != null ? (rule.rateValue < 1 ? pct(rule.rateValue) : rule.rateValue) : "-"}</td>
        </tr>
        ${rule.assumptionWarning ? `<tr><td colspan="5" class="text-muted" style="font-size:12px;">&#9888; ${escapeHtml(rule.assumptionWarning)}</td></tr>` : ""}`,
      )
      .join("");

    return `
      <div class="card" style="margin:8px 0;">
        <div class="card-grid">
          <div><div class="stat-label">Rebate (Old Regime, Sec 156 / old 87A)</div><div>Up to ${rupees(r.rebateMaxOld)} if taxable income &le; ${rupees(r.rebateLimitOld)}</div></div>
          <div><div class="stat-label">Rebate (New Regime, Sec 156 / old 87A)</div><div>Full rebate if taxable income &le; ${rupees(r.rebateLimitNew)}${r.marginalReliefNew ? ", with marginal relief just above it" : ""}</div></div>
          <div><div class="stat-label">HRA Exemption (old Sec 10(13A), now a Schedule)</div><div>${pct(r.hraConfig.metroPercent)} of Basic+DA (metro) / ${pct(r.hraConfig.nonMetroPercent)} (non-metro)</div></div>
          <div><div class="stat-label">Employer PF+NPS+Superannuation Perquisite Threshold (Sec 17 / old 17(2)(vii))</div><div>${rupees(r.employerNpsPfPerqLimit)}/year combined</div></div>
        </div>

        <h3 class="mt-16">Income Slabs by Age Category</h3>
        ${slabsHtml}

        <h3 class="mt-16">Surcharge (with marginal relief)</h3>
        <table><thead><tr><th>Threshold</th><th>Rate</th></tr></thead><tbody>${surchargeRows}</tbody></table>

        <h3 class="mt-16">Chapter VI-A Deduction Limits</h3>
        <table><thead><tr><th>Section</th><th>Limit</th></tr></thead><tbody>${deductionRows}</tbody></table>

        <h3 class="mt-16">Full Rule Catalog</h3>
        <table>
          <thead><tr><th>Rule</th><th>Section</th><th>Calculation Method</th><th>Limit</th><th>Rate</th></tr></thead>
          <tbody>${rulesRows}</tbody>
        </table>
      </div>
    `;
  }

  render();
});

// --- PT Slabs (editable, state-wise Professional Tax) ---------------------
registerView("pt-slabs", "Setup", "PT Slabs", (container) => {
  let editingKey = null;

  function render() {
    const rows = db.ptSlabs
      .map(
        (s) => `
        <tr>
          <td>${s.label}</td>
          <td>${sentenceCase(s.type)}</td>
          <td>${s.type === "MONTHLY" || s.type === "HALF_YEARLY" ? `up to ${rupees(s.slabs[s.slabs.length - 1].amount)}/month` : s.type === "FLAT" ? `${rupees(s.amount)}/month` : "-"}</td>
          <td>${s.seniorExemptionAge != null ? `${s.seniorExemptionAge}+` : "-"}</td>
          <td><button data-key="${s.key}" class="toggle-pt-edit">${editingKey === s.key ? "Cancel" : "Edit"}</button></td>
        </tr>
        ${editingKey === s.key ? `<tr><td colspan="5">${renderPtEditForm(s)}</td></tr>` : ""}`,
      )
      .join("");
    container.innerHTML = `
      <div class="card">
        <p class="text-muted">Professional Tax is levied under each state's own Act, so rates and thresholds vary by state - several states (Delhi, UP, Haryana, Rajasthan, Himachal Pradesh) levy none at all. Assign an employee's state (and date of birth) on their Profile tab to auto-compute their monthly PT from gross salary instead of a fixed amount; leave state unset to keep using the Salary Structure's fixed PT component. Several states also fully exempt employees once they cross a certain age regardless of salary (e.g. Maharashtra and Gujarat at 65, Karnataka at 60) - set "Senior Citizen Exemption Age" below if a state you use has one; it's left blank for states we couldn't confirm an exact age for. Edit a state's slabs below if a rate changes.</p>
        <table>
          <thead><tr><th>State</th><th>Type</th><th>Top Rate</th><th>Senior Exemption</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    container.querySelectorAll(".toggle-pt-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        editingKey = editingKey === btn.dataset.key ? null : btn.dataset.key;
        render();
      }),
    );
  }

  function renderPtEditForm(s) {
    const slabRows = (s.slabs || [])
      .map(
        (slab, i) => `
        <tr>
          <td><input type="number" min="0" class="pt-slab-upto" data-idx="${i}" value="${slab.upTo ?? ""}" placeholder="(no limit - top band)" /></td>
          <td><input type="number" min="0" step="0.01" class="pt-slab-amount" data-idx="${i}" value="${slab.amount}" /></td>
          <td><button type="button" class="danger remove-pt-slab" data-idx="${i}">Remove</button></td>
        </tr>`,
      )
      .join("");
    return `
      <div class="card" style="margin:8px 0;">
        <form id="pt-edit-form" data-key="${s.key}">
          <div class="form-grid">
            <div><label>Type</label>
              <select name="type">
                ${["MONTHLY", "HALF_YEARLY", "FLAT", "NONE", "MANUAL"].map((t) => `<option value="${t}" ${s.type === t ? "selected" : ""}>${sentenceCase(t)}</option>`).join("")}
              </select>
            </div>
            <div><label>Flat Monthly Amount (only used if Type = FLAT)</label><input type="number" min="0" name="amount" value="${s.amount || 0}" /></div>
            <div><label>Senior Citizen Exemption Age (optional)</label><input type="number" min="0" name="seniorExemptionAge" value="${s.seniorExemptionAge ?? ""}" placeholder="e.g. 65 - leave blank if none" /></div>
          </div>
          <div><label class="mt-16">Note</label><textarea name="note" rows="2" style="width:100%;">${escapeHtml(s.note || "")}</textarea></div>
          <h3 class="mt-16">Slabs ${s.type === "HALF_YEARLY" ? "(on half-yearly gross; monthly PT = slab amount / 6)" : "(on monthly gross)"}</h3>
          <table><thead><tr><th>Up To (leave blank for the top/last band)</th><th>Amount</th><th></th></tr></thead><tbody id="pt-slab-rows">${slabRows}</tbody></table>
          <div class="row gap-8 mt-16"><button type="button" id="btn-add-pt-slab">+ Add Slab Row</button></div>
          <div id="pt-edit-error" class="text-bad mt-16"></div>
          <div class="row gap-8 mt-16"><button type="submit" class="primary">Save</button></div>
        </form>
      </div>
    `;
  }

  container.addEventListener("click", async (evt) => {
    if (evt.target.id === "btn-add-pt-slab") {
      const s = db.ptSlabs.find((x) => x.key === editingKey);
      if (!s.slabs) s.slabs = [];
      s.slabs.push({ upTo: null, amount: 0 });
      await persist();
      render();
    } else if (evt.target.classList.contains("remove-pt-slab")) {
      const s = db.ptSlabs.find((x) => x.key === editingKey);
      s.slabs.splice(Number(evt.target.dataset.idx), 1);
      await persist();
      render();
    }
  });

  container.addEventListener("submit", async (evt) => {
    if (evt.target.id !== "pt-edit-form") return;
    evt.preventDefault();
    const s = db.ptSlabs.find((x) => x.key === evt.target.dataset.key);
    const fd = new FormData(evt.target);
    s.type = String(fd.get("type"));
    s.amount = num(fd.get("amount"));
    s.note = String(fd.get("note") || "") || null;
    const seniorAgeRaw = String(fd.get("seniorExemptionAge") || "").trim();
    s.seniorExemptionAge = seniorAgeRaw === "" ? null : num(seniorAgeRaw);
    container.querySelectorAll(".pt-slab-upto").forEach((el) => {
      const row = s.slabs[Number(el.dataset.idx)];
      row.upTo = el.value === "" ? null : num(el.value);
    });
    container.querySelectorAll(".pt-slab-amount").forEach((el) => {
      s.slabs[Number(el.dataset.idx)].amount = num(el.value);
    });
    await persist();
    editingKey = null;
    render();
  });

  render();
});

// --- Backup & Restore ----------------------------------------------------
registerView("backup", "Setup", "Backup & Restore", (container) => {
  render();

  async function render() {
    const folderHandle = await Persistence.getRememberedFolderHandle().catch(() => null);
    const supportsFolder = Persistence.hasFileSystemAccess();
    container.innerHTML = `
      <div class="card">
        <h3>Manual backup</h3>
        <p class="text-muted">Download a full copy of your data (employees, salary structures, declarations, payroll runs, everything) as a JSON file. Keep it somewhere safe.</p>
        <div class="row gap-8">
          <button class="primary" id="btn-download-backup">Download backup now</button>
        </div>
      </div>
      <div class="card">
        <h3>Restore from backup</h3>
        <p class="text-muted">Replaces all data currently in this browser with the contents of the selected backup file. This cannot be undone - download a current backup first if you want to keep it.</p>
        <div class="row gap-8">
          <input type="file" id="restore-file-input" accept="application/json" />
        </div>
      </div>
      <div class="card">
        <h3>Auto-save to a folder</h3>
        <p class="text-muted">Choose a folder once, and every change you make will be automatically written to <code>${Persistence.BACKUP_FILE_NAME}</code> in that folder - no need to remember to download a backup.</p>
        ${
          supportsFolder
            ? `<div class="row gap-8">
                <button class="primary" id="btn-pick-folder">${folderHandle ? "Change auto-save folder" : "Choose auto-save folder"}</button>
                ${folderHandle ? `<button class="danger" id="btn-forget-folder">Stop auto-saving</button>` : ""}
              </div>
              <p class="text-muted mt-16">${folderHandle ? `Currently auto-saving to a chosen folder.` : `No folder chosen yet - changes are only saved in this browser.`}</p>`
            : `<p class="text-bad">Your browser doesn't support folder auto-save (this needs Chrome or Edge). Use manual download/restore instead.</p>`
        }
      </div>
      <div class="card" style="border:1px solid var(--bad);">
        <h3 class="text-bad">Danger Zone</h3>
        <p class="text-muted">Permanently erase <strong>every</strong> company, employee, salary structure, payroll run, declaration and setting in this browser, and start over from a completely blank app - the same state as a fresh install. This cannot be undone.${folderHandle ? " If you have auto-save to a folder set up, the very next change will overwrite that file too - download a manual backup above first if you want to keep a copy." : " Download a manual backup above first if you want to keep a copy."}</p>
        <div class="row gap-8" style="align-items:center;">
          <input type="text" id="delete-all-confirm-input" placeholder="Type DELETE to confirm" style="max-width:220px;" />
          <button class="danger" id="btn-delete-all-data" disabled>Delete All Data</button>
        </div>
      </div>
    `;

    document.getElementById("btn-download-backup").addEventListener("click", () => Persistence.downloadBackupFile(db));

    document.getElementById("restore-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm("This will replace all data currently in this browser with the selected backup file. Continue?")) {
        e.target.value = "";
        return;
      }
      try {
        const restored = await Persistence.restoreFromFile(file);
        db = migrateDb(restored);
        await Persistence.saveDb(db);
        alert("Backup restored successfully.");
        route();
      } catch (err) {
        alert(`Restore failed: ${err.message}`);
      }
      e.target.value = "";
    });

    const pickBtn = document.getElementById("btn-pick-folder");
    if (pickBtn) {
      pickBtn.addEventListener("click", async () => {
        try {
          await Persistence.pickBackupFolder();
          await Persistence.writeBackupToFolder(db);
          await render();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    const forgetBtn = document.getElementById("btn-forget-folder");
    if (forgetBtn) {
      forgetBtn.addEventListener("click", async () => {
        await Persistence.forgetBackupFolder();
        await render();
      });
    }

    const confirmInput = document.getElementById("delete-all-confirm-input");
    const deleteBtn = document.getElementById("btn-delete-all-data");
    confirmInput.addEventListener("input", () => {
      deleteBtn.disabled = confirmInput.value.trim() !== "DELETE";
    });
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("This permanently erases every company, employee, payroll run, declaration and setting in this browser and starts the app over from scratch. This cannot be undone. Continue?")) return;
      db = createEmptyDb();
      seedMasterData(db);
      await Persistence.saveDb(db);
      localStorage.removeItem("activeCompanyId");
      localStorage.removeItem("companyFilter");
      location.reload();
    });
  }
});

// NOTE: the placeholder-fill loop and the boot() call live in bootstrap.js,
// which is loaded last (after every views/*.js file) so real views have a
// chance to register themselves - via registerView() - before any gaps are
// placeholder-filled and before the initial route() render happens.
