export const themeOptions = ["light", "dark"];
export const themeLabels = { light: "Light", dark: "Dark" };
export const appearanceOptions = ["standard", "glass"];
export const appearanceLabels = { standard: "Standard", glass: "Glass" };

export function readStoredPreference(key) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeShellPreference(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Session storage can be unavailable in locked-down browser contexts.
  }
}

export function readShellPreference(key, fallback, allowedValues) {
  const value = readStoredPreference(key);
  return allowedValues.includes(value) ? value : fallback;
}

export function resolveThemeAndAppearance({
  storedTheme = readStoredPreference("manage-theme"),
  storedAppearance = readStoredPreference("manage-appearance"),
} = {}) {
  const migratedFromGlassTheme = storedTheme === "glass";
  const theme = themeOptions.includes(storedTheme) ? storedTheme : migratedFromGlassTheme ? "dark" : "light";
  const appearance = appearanceOptions.includes(storedAppearance)
    ? storedAppearance
    : migratedFromGlassTheme
      ? "glass"
      : "standard";

  return { theme, appearance, migratedFromGlassTheme };
}
