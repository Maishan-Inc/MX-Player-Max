# GitHub Pages Demo Deployment Implementation Plan

Date: 2026-08-16

## Gate

The approved design is
`docs/superpowers/specs/2026-08-16-github-pages-demo-deployment-design.md`.
Keep Docker, CI, npm release, restricted WASM, and real-browser evidence boundaries unchanged.
The Pages deployment remains manual and publishes only a Demo snapshot plus manifest-approved Browser assets.

## Task 1 - Add failing deployment contracts

1. Extend `scripts/release/tests/workflow-config.test.mjs` to require a third
   `.github/workflows/deploy-demo.yml` workflow with manual inputs, minimum Pages permissions, official
   Pages actions, explicit build/verification commands, and no push/pull-request/npm-publish behavior.
2. Add `scripts/release/tests/pages-artifact.test.mjs` for the Pages artifact allowlist, required Demo files,
   missing artifacts, and restricted asset rejection.
3. Add `apps/demo/src/deployment.test.ts` for repository URL, base-aware default media resolution, and
   version fallback.
4. Update the documentation contract so GitHub Pages is allowed only when its Docker/security limitations
   are documented.
5. Run focused tests and confirm they fail for the missing workflow, helper, and Pages preparation module.

## Task 2 - Make the Demo Pages-aware

1. Add `apps/demo/src/deployment.ts` with pure helpers/constants for the repository URL, default media URL,
   and displayed build version.
2. Update `apps/demo/src/App.tsx` to consume those helpers without changing player or diagnostic behavior.
3. Update `apps/demo/vite.config.ts` so only Vite `pages` mode uses a relative base; local, Playwright, and
   Docker builds remain rooted at `/`.
4. Add `apps/demo/public/.nojekyll` and an app-level `build:pages` script.
5. Run the focused Demo tests and typecheck.

## Task 3 - Prepare and verify the Pages artifact

1. Add `scripts/release/prepare-pages.mjs` using structured filesystem and manifest parsing APIs.
2. Require `index.html`, `.nojekyll`, and `flower.webm` in `apps/demo/dist`.
3. Read and validate `packages/browser/dist/manifest.json`; copy only publishable
   `@mx-player-max/browser` entries plus the manifest into `apps/demo/dist/sdk`.
4. Reject missing allowlisted files, unexpected SDK output, and any excluded WASM/model asset in the final
   Pages tree.
5. Add root `build:pages` and `test:pages` scripts, then run the artifact unit tests and a real Pages build.

## Task 4 - Add Pages browser smoke

1. Add `playwright.pages.config.ts` with one Chromium project and a preview server mounted at
   `/MX-Player-Max/`.
2. Add `tests/browser/pages/pages.spec.ts` to verify a nonblank player, visible build version, repository
   link, base-aware media URL, media response, and `/sdk/manifest.json`.
3. Run `pnpm exec playwright install chromium` if needed, then run `pnpm test:pages` against the prepared
   artifact.

## Task 5 - Add the manual deployment workflow

1. Add `.github/workflows/deploy-demo.yml` with only `workflow_dispatch`, `version`, and `deploy_pages`.
2. In the build job, install frozen dependencies, run typecheck/tests/build/package checks, install Chromium,
   run Pages smoke, and upload `apps/demo/dist` with `actions/upload-pages-artifact`.
3. In the deployment job, request only `contents: read`, `pages: write`, and `id-token: write`, bind the
   `github-pages` environment, check Pages availability, and conditionally configure/deploy or explain setup.
4. Run the workflow contract tests and inspect the YAML for shell interpolation and permission boundaries.

## Task 6 - Document the deployment boundary

1. Update `README.md` and `apps/demo/README.md` with the default Pages URL, manual workflow, local Pages
   commands, and Docker distinction.
2. Update `docs/development/release.md` and `docs/architecture/distribution-and-embedding.md` with artifact
   flow, `/sdk/`, Pages Settings prerequisite, and header/WASM limitations.
3. Add an Unreleased Changelog entry and mark the approved design implemented after verification.

## Task 7 - Verify and finish

1. Run `pnpm test:update-counts` for the new Demo unit tests, then `pnpm test` to verify the recorded counts.
2. Run `pnpm typecheck`, `pnpm build:pages`, `pnpm test:release`, `pnpm verify:packages`, and
   `pnpm test:pages`.
3. Run the existing `pnpm test:browser` suite to ensure the standard root-base Demo remains intact.
4. Run `git diff --check`, inspect generated output/manifest contents, remove generated Playwright metadata,
   and verify no restricted assets or unrelated changes enter the commit.

## Stop Conditions

- If a Pages build needs absolute repository-specific URLs, stop and fix the base contract rather than
  hard-coding `/MX-Player-Max/` into application runtime code.
- If the publishable manifest cannot express the Browser SDK allowlist, stop before copying whole package or
  workspace directories.
- If GitHub Pages would be described as cross-origin isolated or equivalent to Docker, stop and correct the
  deployment/documentation boundary.
- A local workflow contract cannot prove a real deployment; keep remote Pages status pending until the manual
  workflow succeeds in GitHub.
