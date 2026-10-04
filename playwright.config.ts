import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:1438",
    channel: "chrome",
    viewport: { width: 920, height: 760 },
  },
  webServer: {
    command: "npm run dev -- --port 1438 --host 127.0.0.1",
    url: "http://127.0.0.1:1438",
    reuseExistingServer: false,
  },
});
