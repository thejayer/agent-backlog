import { describe, expect, it } from "vitest";
import {
  appearanceLabels,
  appearanceOptions,
  resolveThemeAndAppearance,
  themeLabels,
  themeOptions,
} from "./shellPreferences.mjs";

describe("resolveThemeAndAppearance", () => {
  it("defaults to light theme and Standard appearance", () => {
    expect(resolveThemeAndAppearance({ storedTheme: null, storedAppearance: null })).toEqual({
      theme: "light",
      appearance: "standard",
      migratedFromGlassTheme: false,
    });
  });

  it("keeps persisted light/dark theme and Standard/Glass appearance", () => {
    expect(resolveThemeAndAppearance({ storedTheme: "dark", storedAppearance: "glass" })).toEqual({
      theme: "dark",
      appearance: "glass",
      migratedFromGlassTheme: false,
    });
    expect(resolveThemeAndAppearance({ storedTheme: "light", storedAppearance: "standard" })).toEqual({
      theme: "light",
      appearance: "standard",
      migratedFromGlassTheme: false,
    });
  });

  it("migrates leftover theme=glass to dark theme plus Glass appearance", () => {
    expect(resolveThemeAndAppearance({ storedTheme: "glass", storedAppearance: null })).toEqual({
      theme: "dark",
      appearance: "glass",
      migratedFromGlassTheme: true,
    });
  });

  it("does not override an already persisted appearance when migrating theme=glass", () => {
    expect(resolveThemeAndAppearance({ storedTheme: "glass", storedAppearance: "standard" })).toEqual({
      theme: "dark",
      appearance: "standard",
      migratedFromGlassTheme: true,
    });
  });
});

describe("shell preference labels", () => {
  it("exposes unbranded theme and appearance options", () => {
    expect(themeOptions).toEqual(["light", "dark"]);
    expect(appearanceOptions).toEqual(["standard", "glass"]);
    expect(themeLabels).toEqual({ light: "Light", dark: "Dark" });
    expect(appearanceLabels).toEqual({ standard: "Standard", glass: "Glass" });
    expect(JSON.stringify({ themeLabels, appearanceLabels })).not.toMatch(/Harbor|Glassy|Commerce Street|RegVault|CSC-|COM-/i);
  });
});
