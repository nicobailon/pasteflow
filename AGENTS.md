# Repository Guidelines

## Project Structure & Modules
- `src/`: Application source code (TypeScript)
  - `src/components/`: React UI components
  - `src/main/`: Electron main, preload, IPC, API server, DB layer
  - `src/__tests__/` and `src/main/__tests__/`: unit/integration tests
  - `src/assets/`, `src/styles/`, `src/utils/`, `src/hooks/`
- `public/`: app icons/assets for packaging
- `build/`: compiled main/scripts and packaging artifacts
- `dist/`: Vite renderer build output
- `scripts/`: TypeScript build/release utilities (run via `tsx`)

## Build, Test, and Dev Commands
- `npm run dev:electron`: starts Vite + Electron for full local dev.
- `npm run dev`: Vite-only UI server (usually use `dev:electron`).
- `npm run build`: Vite production build to `dist/`.
- `npm run build:main:esm`: build Electron main (ESM) + preload/worker (CJS) to `build/main/` via tsup.
- `npm run package[:mac|:win|:linux|:all]`: build + electron‑builder packaging.
- `npm test` | `npm run test:watch`: run Jest suite (ts-jest).
- `npm run lint` | `npm run lint:strict`: lint codebase.
- Helpful: `npm run verify-build`, `npm run test-build[:mac|:win|:linux]`.

## Coding Style & Naming
- Language: TypeScript (React + Electron).
- Files: kebab-case enforced (`filenames` plugin). Components export PascalCase symbols.
- Hooks: prefix with `use*` (e.g., `use-file-system.ts`).
- Indentation/spaces: 2 spaces; semicolons required; double quotes preferred.
- Imports: ordered via `import/order` (grouped, blank lines between groups).
- Linting: ESLint with `@typescript-eslint`, `react`, `jsx-a11y`, `sonarjs`, `unicorn`.

## Testing Guidelines
- Runner: Jest + `ts-jest` with `jsdom` env.
- Locations: `src/__tests__/**/*.test.ts[x]`, `src/main/__tests__/**/*.test.ts`.
- Commands: `npm test`, `npm run test:unit|:integration|:e2e`, `npm run test:ci` (with coverage).
- Coverage: collected on key modules (see `jest.config.js`); avoid skipped tests; prefer behavior over implementation details (see `TESTING.md`).
- Naming: use `*.test.ts` or `*.test.tsx`; focus on real assertions and error paths.

## Commit & PR Guidelines
- Commit style: conventional prefixes observed in history — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`. Scope optional (e.g., `feat(api): …`).
- PRs should include: clear description, linked issue (e.g., `Closes #123`), test coverage for changes, screenshots for UI tweaks, and notes on build/pack impact if any.

## Security & Configuration Tips
- Electron target/version pinned in `.npmrc`; native deps (e.g., `better-sqlite3`) rebuild on install.
- Packaging uses `electron-builder` with notarization hook compiled to `build/scripts/notarize.js`.
- Avoid committing secrets; use env/CI secrets. Validate paths and inputs in main/IPC layers.

## React Guidelines
- write idiomatic react
- use component composition 
- use computed values, you don't need use effect

## Agent Approvals UI (Phase 3)
- Renderer approvals experience is gated by the `agent.approvals.v2Enabled` preference (and `AGENT_APPROVAL_V2` env flag).
- When enabled, the panel uses `useAgentApprovals` to manage state/actions and renders `AgentApprovalList` between notifications and messages.
- Preload exposes typed helpers under `window.electron.approvals` for `list`, `apply`, `reject`, `cancel`, `rules`, and live watch events; always call these instead of raw channels.
- Legacy `AgentToolCalls` auto-approval behavior is disabled when the new UI flag is on; use the approvals list instead.
