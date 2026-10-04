import { test, expect } from "@playwright/test";

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
