import { setTheme, THEMES, type ThemeId, useTheme } from "../../ui";

/** Try-out control for comparing visual styles. */
export function ThemeSwitcher() {
  const { id } = useTheme();
  return (
    <label className="theme-switcher box tight on-night">
      <span className="label">Style</span>
      <select value={id} onChange={(e) => setTheme(e.target.value as ThemeId)} aria-label="Visual style">
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
