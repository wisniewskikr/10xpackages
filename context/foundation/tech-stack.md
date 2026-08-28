---
starter_id: none
package_manager: npm
project_name: 10x-packages
hints:
  language_family: js
  team_size: solo
  deployment_target: github-packages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: best-effort
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: false
    conventions: false
    docs_current: false
    can_judge_agent: true
  has_auth: false
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

10xPackages is an npm package that bundles AI skills, rules, an installer/uninstaller
CLI, and a publish pipeline — a build-and-install tool over text files, not a web app
or an HTTP service. The starter registry carries no card for a plain TypeScript
library or CLI (`cli.js` is explicitly `<none>`), so this is a custom, hand-rolled
scaffold: `npm init` plus a conventional package layout (`src/`, `bin/`, `dist/`,
`test/`), TypeScript for explicit contracts at the manifest and sentinel-marker
boundaries, tsup for a thin build, and Vitest for the idempotency and marker-guard
tests the PRD guardrails demand. npm is the home ecosystem — the consumer install
path is `npm install` / `npx` with `.npmrc` registry mapping (FR-005, FR-006). Solo
maintainer, 3-week after-hours budget, small scale: minimal dependencies and
mainstream tooling keep agent friction low. Publishing runs in GitHub Actions to the
org's private GitHub Packages registry, authenticated with the short-lived
`GITHUB_TOKEN` (no stored secret, FR-003), auto-publishing on merge to main behind a
git-diff gate on packaged files. Bootstrapper confidence is best-effort: there is no
generator to run, so `/10x-bootstrapper` will surface manual `npm init` steps rather
than scaffold automatically.
