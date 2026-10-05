export type Browser = "default" | "chrome" | "edge" | "firefox" | "safari";
// A tagged action keeps future task types separate from webmail settings.
export type Action = { type: "webmail"; browser: Browser; url: string };
export type TaskButton = { id: string; name: string; action: Action };
export type Settings = { version: 1; buttons: TaskButton[] };
export type SettingsChange =
  | { type: "add"; button: TaskButton }
  | { type: "update"; button: TaskButton }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; direction: "up" | "down" };

// Apply an action to the latest saved settings, never to a window's stale copy.
export function applySettingsChange(
  settings: Settings,
  change: SettingsChange,
): Settings {
  const buttons = [...settings.buttons];
  const id = "button" in change ? change.button.id : change.id;
  const index = buttons.findIndex((button) => button.id === id);
  if (change.type === "add") {
    if (index !== -1) throw new Error("Button already exists.");
    if (buttons.length >= 100)
      throw new Error("A maximum of 100 buttons is supported.");
    buttons.push(change.button);
  } else {
    if (index === -1) throw new Error("Button no longer exists.");
    if (change.type === "update") buttons[index] = change.button;
    else if (change.type === "delete") buttons.splice(index, 1);
    else {
      const target = index + (change.direction === "up" ? -1 : 1);
      if (target < 0 || target >= buttons.length)
        throw new Error("Button cannot move further in that direction.");
      [buttons[index], buttons[target]] = [buttons[target], buttons[index]];
    }
  }
  if ("button" in change) {
    const error = validateButton(change.button);
    if (error) throw new Error(error);
  }
  return { ...settings, buttons };
}
export const services = [
  { name: "Outlook · Work or school", url: "https://outlook.office.com/mail/" },
  { name: "Hotmail · Personal Outlook", url: "https://outlook.live.com/mail/" },
  { name: "Gmail", url: "https://mail.google.com/" },
];
export const browsers: { value: Browser; label: string }[] = [
  { value: "default", label: "System default" },
  { value: "chrome", label: "Google Chrome" },
  { value: "edge", label: "Microsoft Edge" },
  { value: "firefox", label: "Mozilla Firefox" },
  { value: "safari", label: "Safari" },
];
export const defaults: Settings = {
  version: 1,
  buttons: [
    {
      id: "outlook",
      name: "Work email",
      action: { type: "webmail", browser: "default", url: services[0].url },
    },
    {
      id: "gmail",
      name: "Gmail",
      action: { type: "webmail", browser: "default", url: services[2].url },
    },
    {
      id: "hotmail",
      name: "Personal email",
      action: { type: "webmail", browser: "default", url: services[1].url },
    },
  ],
};
export function validateButton(button: TaskButton): string | undefined {
  if (!button.name.trim() || Array.from(button.name).length > 80)
    return "Enter a name between 1 and 80 characters.";
  try {
    const url = new URL(button.action.url);
    if (
      button.action.url.length > 2048 ||
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error();
  } catch {
    return "Enter a valid HTTPS address without embedded credentials.";
  }
}
