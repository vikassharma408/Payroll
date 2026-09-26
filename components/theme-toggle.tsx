"use client";

import { useState } from "react";

const STORAGE_KEY = "payrollin-theme";

export function ThemeToggle() {
  // Lazy initializer (not an effect): the inline script in layout.tsx already
  // set data-theme on <html> before hydration, so it's safe to read here.
  const [isLight, setIsLight] = useState(
    () => typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light",
  );

  function toggle() {
    const next = !isLight;
    setIsLight(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "light");
      try {
        localStorage.setItem(STORAGE_KEY, "light");
      } catch {
        // localStorage unavailable (private browsing etc.) - theme just won't persist
      }
    } else {
      document.documentElement.removeAttribute("data-theme");
      try {
        localStorage.setItem(STORAGE_KEY, "dark");
      } catch {
        // ignore
      }
    }
    window.dispatchEvent(new Event("theme-change"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--ink-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--ivory)] hover:bg-[var(--ink-3)]"
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span aria-hidden>{isLight ? "☀" : "☾"}</span>
      {isLight ? "Light" : "Dark"}
    </button>
  );
}
