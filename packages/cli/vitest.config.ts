import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // CLI integration tests spawn real child processes; the default 5s timeout
    // is too aggressive when the whole workspace runs in parallel.
    testTimeout: 60_000,
    // Existing assertions cover the zh/en copy; the Korean UI locale is opt-out here.
    env: { INKOS_UI_LOCALE: "follow" },
  },
});
