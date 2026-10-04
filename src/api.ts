import { invoke, isTauri } from "@tauri-apps/api/core";
import { defaults, type Settings } from "./model";
export const desktop = isTauri();
const key = "task-dashboard-preview-v1";
export async function loadSettings(): Promise<Settings> {
  if (desktop) return invoke("load_settings");
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : structuredClone(defaults);
}
export async function saveSettings(settings: Settings): Promise<void> {
  if (desktop) return invoke("save_settings", { settings });
  localStorage.setItem(key, JSON.stringify(settings));
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
