# Playwright Resource Isolation Implementation Plan

Date: 2026-08-16

## Gate

The approved design is
`docs/superpowers/specs/2026-08-16-playwright-resource-isolation-design.md`.
The existing failing reproduction is a concurrent Chromium/Firefox performance run where Firefox
`firstSubtitleMs` exceeds 2500ms. The same Firefox project passed 10 consecutive tests with one worker.
Do not change application code or performance thresholds.

## Task 1 - `test(browser): isolate performance projects`

1. In `playwright.config.ts`, name the seven UI/media projects that may retain normal concurrency.
2. Make `performance-chromium` depend on all seven UI/media projects.
3. Make `performance-firefox` depend on `performance-chromium`.
4. Run `pnpm exec playwright test --project performance-firefox --list` and verify that Playwright
   includes the transitive UI/media and Chromium performance dependencies.
5. Run the isolated Firefox performance project repeatedly with one worker while keeping the existing
   2500ms assertion unchanged.

## Task 2 - `docs(testing): document performance isolation`

1. Update `docs/development/testing.md` to state that functional projects run concurrently, followed by
   serial Chromium and Firefox performance projects.
2. Explain that `fullyParallel: false` does not isolate projects and that performance thresholds must not
   be collected under unrelated browser load.
3. Add an Unreleased Changed entry to `CHANGELOG.md` for the stable default browser-test scheduling.

## Task 3 - Verify repeatability

1. Run `pnpm typecheck`.
2. Run `pnpm test` because repository completion rules require the workspace suite after code or docs changes.
3. Run `pnpm test:browser` three consecutive times. Each run must pass without retries; supported-platform
   skips remain valid.
4. Run `git diff --check` and inspect the final diff for unrelated changes.
5. Remove or exclude generated Playwright artifacts from the implementation commit.

## Stop Conditions

- If the dependency graph does not prevent the two performance projects from overlapping, stop and revise
  the scheduling design instead of loosening thresholds.
- If any of the three default runs fails, inspect the new failure signature before making another change.
- If a product test fails outside the known timing signature, treat it as a separate regression and do not
  mask it with retries.
