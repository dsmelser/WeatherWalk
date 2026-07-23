// The triple-slash reference pulls in Vitest's additions to Vite's config
// type, so the `test` block below typechecks.
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset URLs in the built index.html ('./assets/…' instead of
  // '/assets/…'), so the build works hosted at any subpath — e.g. GitHub
  // Pages' /WeatherWalk/ — without configuration.
  base: './',
  // Vitest config lives inside the Vite config (one file, shared pipeline).
  test: {
    include: ['tests/**/*.test.ts'],
    // Pure-logic tests need no browser/DOM emulation — plain Node is enough.
    environment: 'node',
  },
})
