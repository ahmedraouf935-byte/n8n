"use client";
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="rounded-lg px-2 py-1 text-xs text-text-2 hover:bg-surface-2"
      onClick={() => {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        try { localStorage.setItem("safqa-theme", root.dataset.theme); } catch {}
      }}
    >
      ◐ المظهر
    </button>
  );
}
