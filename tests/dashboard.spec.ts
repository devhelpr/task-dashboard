import { test, expect, type Page } from "@playwright/test";
import { defaults, type Settings, type SettingsChange } from "../src/model";

const storageKey = "task-dashboard-preview-v1";

type DesktopMock = {
  isTauri: boolean;
  __TAURI_INTERNALS__: {
    invoke: (
      command: string,
      args?: { change: SettingsChange },
    ) => Promise<unknown>;
  };
  releaseInitialLoad: () => void;
  savedChanges: SettingsChange[];
};

test("a delayed desktop startup load cannot reset saved button settings", async ({
  page,
}) => {
  await page.addInitScript((initial) => {
    const mock = window as unknown as DesktopMock;
    mock.isTauri = true;
    mock.savedChanges = [];
    let settings = structuredClone(initial);
    let loads = 0;
    mock.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "platform") return "macos";
        if (command === "load_settings") {
          const snapshot = structuredClone(settings);
          // StrictMode's discarded first effect resolves after the active load
          // and subsequent edits. It must never replace the current state.
          if (++loads === 1) {
            return new Promise((resolve) => {
              mock.releaseInitialLoad = () => resolve(snapshot);
            });
          }
          return snapshot;
        }
        if (command === "change_settings" && args?.change.type === "update") {
          const change = args.change;
          mock.savedChanges.push(change);
          settings = {
            ...settings,
            buttons: settings.buttons.map((button) =>
              button.id === change.button.id ? change.button : button,
            ),
          };
          return structuredClone(settings);
        }
        throw new Error(`Unexpected desktop command: ${command}`);
      },
    };
  }, defaults);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit Gmail", exact: true }).click();
  await page.getByLabel("Button name").fill("Saved team inbox");
  await page.getByLabel("Web address").fill("https://team.example.com/mail");
  await page.getByLabel("Open with").selectOption("firefox");
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.evaluate(async () => {
    (window as unknown as DesktopMock).releaseInitialLoad();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(
    page.getByRole("heading", { name: "Saved team inbox", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Work email", exact: true })
    .click();
  await page.getByLabel("Button name").fill("Saved work inbox");
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved team inbox", exact: true }),
  ).toBeVisible();
  const changes = await page.evaluate(
    () => (window as unknown as DesktopMock).savedChanges,
  );
  expect(changes).toEqual([
    {
      type: "update",
      button: {
        id: "gmail",
        name: "Saved team inbox",
        action: {
          type: "webmail",
          browser: "firefox",
          url: "https://team.example.com/mail",
        },
      },
    },
    {
      type: "update",
      button: { ...defaults.buttons[0], name: "Saved work inbox" },
    },
  ]);
});

async function storedSettings(page: Page): Promise<Settings> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
}

for (const action of ["add", "delete", "move"] as const) {
  test(`${action} from a stale window preserves another button's saved settings`, async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page.locator(".task")).toHaveCount(3);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const other = await context.newPage();
    await other.goto("/");
    await other.getByRole("button", { name: "Settings", exact: true }).click();
    await other
      .getByRole("button", { name: "Edit Gmail", exact: true })
      .click();
    await other.getByLabel("Button name").fill("Updated team inbox");
    await other
      .getByLabel("Web address")
      .fill("https://team.example.com/inbox?folder=shared");
    await other.getByLabel("Open with").selectOption("firefox");
    await other
      .getByRole("button", { name: "Save button", exact: true })
      .click();
    await expect(other.getByRole("dialog")).not.toBeVisible();
    const expected = await storedSettings(other);

    if (action === "add") {
      await page.getByRole("button", { name: /Add button/ }).click();
      await page.getByLabel("Button name").fill("Extra inbox");
      await page.getByLabel("Email environment").selectOption("custom");
      await page
        .getByLabel("Web address")
        .fill("https://extra.example.com/mail");
      await page.getByLabel("Open with").selectOption("edge");
      await page
        .getByRole("button", { name: "Save button", exact: true })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      const saved = await storedSettings(page);
      expect(saved.buttons.slice(0, 3)).toEqual(expected.buttons);
      expect(saved.buttons[3]).toEqual({
        id: expect.any(String),
        name: "Extra inbox",
        action: {
          type: "webmail",
          browser: "edge",
          url: "https://extra.example.com/mail",
        },
      });
      expected.buttons.push(saved.buttons[3]);
    } else if (action === "delete") {
      await page
        .getByRole("button", { name: "Delete Work email", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete button", exact: true })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      expected.buttons.shift();
    } else {
      // Change order in the other tab first. The stale window must move by ID,
      // relative to the latest order, rather than overwrite its old array.
      await other
        .getByRole("button", { name: "Move Work email down", exact: true })
        .click();
      await expect(other.locator(".settings-row").nth(0)).toContainText(
        "Updated team inbox",
      );
      [expected.buttons[0], expected.buttons[1]] = [
        expected.buttons[1],
        expected.buttons[0],
      ];
      await page
        .getByRole("button", { name: "Move Work email down", exact: true })
        .click();
      [expected.buttons[1], expected.buttons[2]] = [
        expected.buttons[2],
        expected.buttons[1],
      ];
    }
    await expect.poll(() => storedSettings(page)).toEqual(expected);
    await expect(
      page.locator(".settings-row").filter({ hasText: "Updated team inbox" }),
    ).toContainText("Mozilla Firefox");
    await page.reload();
    await expect(page.locator(".task")).toHaveCount(expected.buttons.length);
    expect(await storedSettings(page)).toEqual(expected);
  });
}

test("a stale editor cannot restore a deleted button", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Work email", exact: true })
    .click();
  await page.getByLabel("Button name").fill("Should not return");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Settings", exact: true }).click();
  await other
    .getByRole("button", { name: "Delete Work email", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Delete button", exact: true })
    .click();
  await expect(other.getByRole("dialog")).not.toBeVisible();
  const expected = await storedSettings(other);
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Button no longer exists",
  );
  expect(await storedSettings(page)).toEqual(expected);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(page.locator(".task")).toHaveCount(2);
});

for (const staleWindow of [false, true]) {
  test(`editing the first button preserves other customized buttons (${staleWindow ? "stale window" : "same window"})`, async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const initial: Settings = structuredClone(defaults);
    initial.buttons[1] = {
      id: "gmail",
      name: "Team inbox",
      action: {
        type: "webmail",
        browser: "firefox",
        url: "https://mail.example.com/team?folder=shared",
      },
    };
    initial.buttons[2] = {
      id: "hotmail",
      name: "Private inbox",
      action: {
        type: "webmail",
        browser: "edge",
        url: "https://personal.example.com/inbox",
      },
    };
    await page.evaluate(
      ({ key, settings }) =>
        localStorage.setItem(key, JSON.stringify(settings)),
      { key: storageKey, settings: initial },
    );
    await page.reload();
    await expect(page.locator(".task")).toHaveCount(3);
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const other = staleWindow ? await context.newPage() : page;
    if (staleWindow) {
      await other.goto("/");
      await other
        .getByRole("button", { name: "Settings", exact: true })
        .click();
    }
    await other
      .getByRole("button", { name: "Edit Team inbox", exact: true })
      .click();
    await other.getByLabel("Button name").fill("Updated team inbox");
    await other
      .getByLabel("Web address")
      .fill("https://team.example.com/mail?view=all");
    await other.getByLabel("Open with").selectOption("chrome");
    await other
      .getByRole("button", { name: "Save button", exact: true })
      .click();
    await expect(other.getByRole("dialog")).not.toBeVisible();
    const before = await storedSettings(other);

    await page
      .getByRole("button", { name: "Edit Work email", exact: true })
      .click();
    await page.getByLabel("Button name").fill("Updated work inbox");
    await page.getByLabel("Web address").fill("https://work.example.com/inbox");
    await page.getByLabel("Open with").selectOption("edge");
    await page
      .getByRole("button", { name: "Save button", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const expected = structuredClone(before);
    expected.buttons[0] = {
      id: "outlook",
      name: "Updated work inbox",
      action: {
        type: "webmail",
        browser: "edge",
        url: "https://work.example.com/inbox",
      },
    };
    expect(await storedSettings(page)).toEqual(expected);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const button of expected.buttons) {
      await page
        .getByRole("button", { name: `Edit ${button.name}`, exact: true })
        .click();
      await expect(page.getByLabel("Button name")).toHaveValue(button.name);
      await expect(page.getByLabel("Web address")).toHaveValue(
        button.action.url,
      );
      await expect(page.getByLabel("Open with")).toHaveValue(
        button.action.browser,
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  });
}

test("manage, reorder, persist, and delete webmail buttons", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Work email outlook/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Add button/ }).click();
  await page.getByLabel("Button name").fill("Team inbox");
  await page.getByLabel("Email environment").selectOption("custom");
  await page.getByLabel("Web address").fill("http://mail.example.com");
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTPS");
  await page.getByLabel("Web address").fill("https://mail.example.com/team");
  await page.getByLabel("Open with").selectOption("firefox");
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Edit Team inbox", exact: true })
    .click();
  await page.getByLabel("Button name").fill("Shared email");
  await page.getByRole("button", { name: "Save button", exact: true }).click();
  await page
    .getByRole("button", { name: "Move Shared email up", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator(".settings-row").nth(2)).toContainText(
    "Shared email",
  );
  await page.reload();
  await expect(page.locator(".task").nth(2)).toContainText("Shared email");
  await page
    .getByRole("button", { name: /Shared email mail.example.com/ })
    .click();
  await expect(page.getByRole("alert")).toContainText("desktop app");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete Shared email", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep button", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Shared email", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Shared email",
    "Work email",
    "Gmail",
    "Personal email",
  ]) {
    await page
      .getByRole("button", { name: `Delete ${name}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete button", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "A fresh start." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A fresh start." }),
  ).toBeVisible();
});

test("dashboard and editor layout, keyboard cancellation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".task")).toHaveCount(3);
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Add button/ }).click();
  await expect(page.getByLabel("Button name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".settings-row")).toHaveCount(3);
  await page.setViewportSize({ width: 520, height: 560 });
  await expect(
    page.getByRole("button", { name: "Edit Work email", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/settings-small.png",
    fullPage: true,
  });
});
