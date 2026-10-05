import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  applySettingsChange,
  defaults,
  type Settings,
  type SettingsChange,
} from "./model";
export const desktop = isTauri();
const key = "task-dashboard-preview-v1";
export async function loadSettings(): Promise<Settings> {
  if (desktop) return invoke("load_settings");
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : structuredClone(defaults);
}
export async function changeSettings(
  change: SettingsChange,
): Promise<Settings> {
  if (desktop) return invoke("change_settings", { change });
  // Serialize read-modify-write operations across preview tabs as well.
  return navigator.locks.request(key, async () => {
    const settings = applySettingsChange(await loadSettings(), change);
    localStorage.setItem(key, JSON.stringify(settings));
    return settings;
  });
}
export async function getPlatform(): Promise<string> {
  return desktop ? invoke("platform") : "preview";
}
export async function launchButton(id: string): Promise<void> {
  if (!desktop)
    throw new Error(
      "Browser launching is available in the desktop app. Run npm run tauri dev.",
    );
  return invoke("launch_button", { id });
}
