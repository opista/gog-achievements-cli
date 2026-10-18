# Contributing

See the [README](README.md) for CLI use and the [CLI reference](docs/cli-reference.md) for command options and operational details.

## Development and builds

Source use requires Node 22 or later. Use the Node 24 version in `.node-version` for development and release builds. Mac builds require Xcode Command Line Tools. Windows builds require the .NET 10 SDK selected by `global.json`.

Run `npm ci --ignore-scripts`, then:

```sh
npm run check
npm run test:coverage
npm run build
```

Use `npm run build -- --target TARGET` to select `macos-arm64`, `macos-x64`, `windows-arm64` or `windows-x64`. Run the build on that OS with matching Node architecture. Use `npm run build -- --help` for details. The default is the current OS and Node architecture; other targets' output files are kept.

For example, build `macos-arm64` with:

```sh
npm run build -- --target macos-arm64
```

`macos-x64` requires x64 Node, including when using Rosetta on Apple Silicon. A target mismatch fails before compilation or file changes. CI builds all four targets on matching runners.

`build` compiles the native helper, bundles the current Node runtime, runs smoke checks outside the checkout, and creates a ZIP and SHA-256 checksum in `dist/`. For example:

```text
dist/gog-achievements-VERSION-macos-arm64/gog-achievements
dist/gog-achievements-VERSION-macos-arm64.zip
dist/gog-achievements-VERSION-macos-arm64.zip.sha256
```

Apple Silicon and Windows packages embed the runtime and helper in one executable. Intel Mac packages use a native launcher with private `lib` and `native` folders because of Node's single-executable limitation on that platform. Keep the extracted folder intact. Release executables need no separate Node, npm, .NET or compiler installation. Windows sign-in needs the WebView2 Runtime.

`check` performs one strict TypeScript compilation of application code, tests and JavaScript tooling, then checks source formats, syntax, ESLint and Prettier. Application source must use `.mts`; `src/index.mjs` is the only JavaScript facade. `npm run compile` emits application code, tests and tooling under `.build/typescript/`; tests run that emitted code. Use `npm run format` to format changes. Coverage must meet 95% lines, 85% branches and 90% functions for `src/`. Tests use fixtures, temporary files and a local HTTP server. They never write achievements to a real GOG account.

Application code, tests and fixtures use strict TypeScript ESM (`.mts`). Compilation also emits declarations. Run `npm run compile` after installation and source edits; check, test, demo and build commands compile automatically. Build help and target validation run before compilation. Tool commands reuse compilation only when source files, compiler version, configuration and every emitted file match their saved hashes. Compilation uses staging at the same directory depth to preserve source maps. Build, test, demo and source-package checks hold a lease while they use the output. Another tool waits up to 30 seconds. If a process is killed, confirm it has stopped before removing `.build/typescript.lock` as directed by the error. After compilation, use `node bin/gog-achievements.mjs` for source commands. Source sign-in and credential operations need the native helper from `npm run build`.

To install the source command on PATH after building the helper, use `npm install --global . --ignore-scripts`. This source installation requires Node. `npm run demo` prints an offline fixture workflow without GOG requests or access to your login.

## Code map

| File                                                   | Responsibility                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `src/index.mjs`, `src/index.mts`                       | Compatible public exports and generated type declarations.                           |
| `src/cli.mts`, `src/service.mts`                       | Compatible public facades and production dependency defaults.                        |
| `src/domain/values.mts`                                | Pure string ID and UTC date rules.                                                   |
| `src/domain/queue.mts`                                 | Queue validation, selection and immutable edits.                                     |
| `src/domain/restoration.mts`                           | Pure whole-queue restoration planning.                                               |
| `src/application/ports.mts`, `*-ports.mts`             | Compatibility exports and focused auth, achievement, native and HTTP contracts.      |
| `src/application/service-contract.mts`                 | Application operations used by CLI handlers.                                         |
| `src/application/session.mts`                          | Login, refresh, cached credentials and logout.                                       |
| `src/application/service.mts`                          | Account checks, queries and queue preparation.                                       |
| `src/application/queue-execution.mts`                  | Ordered writes and identity-aware readback verification.                             |
| `src/adapters/gog-api.mts`                             | HTTP requests, paging and response validation.                                       |
| `src/adapters/queue-files.mts`                         | Atomic file operations and complete queue lock transactions.                         |
| `src/adapters/input.mts`                               | Stdin and clipboard access.                                                          |
| `src/adapters/native/`                                 | Verified assets, private IPC, credential storage and login lifecycle.                |
| `src/cli/definitions.mts`                              | Shared command, flag and help definitions.                                           |
| `src/cli/parse.mts`, `src/cli/handlers.mts`            | Typed parsing, shared result/error handling and command dispatch.                    |
| `src/cli/*-handlers.mts`, `src/cli/update-handler.mts` | Auth, queue, query and update command families with narrow dependencies.             |
| `src/cli/output.mts`                                   | Pure text and JSON rendering.                                                        |
| `native/gog-login.swift`, `native/macos/`              | macOS bootstrap, protocol validation, WebKit window and Keychain storage.            |
| `native/login-protocol-cases.json`                     | Shared callback, configuration and navigation cases embedded in both native helpers. |
| `native/windows/`                                      | Windows WebView2 sign-in and DPAPI storage.                                          |
| `scripts/build.mjs`, `scripts/package.mjs`             | Shared bundling and packaging used by release builds and update-flow tests.          |
| `scripts/compile.mjs`                                  | Verified compilation reuse and exclusive output leases.                              |
| `scripts/build-targets.mjs`                            | Shared target definitions and build argument validation.                             |

The source-format check rejects JavaScript application files except the public import facade. The build configuration includes checked JavaScript tooling so its declarations and emitted paths are available to tests. Keep boundary input `unknown` until validation. The fixture contract snapshots preserve the JavaScript baseline, including exact text/JSON, queue bytes and request order.

ESLint enforces the dependency direction: domain modules use other domain modules; application modules use domain functions and ports; adapters implement ports; CLI handlers receive operations as dependencies. The root facades and entry point supply production dependencies. Domain functions receive the current time explicitly and return new values. Parsing and output also stay free of host effects. Only native port contracts use Node type imports in the application layer; these imports produce no runtime dependency. Root re-export modules preserve existing source imports.

Keep account operations in the application service and HTTP details in the API adapter. Keep the queue lock around the full command transaction, including remote apply operations. Add tests for behaviour and failure paths; avoid tests that only copy an implementation. Frozen-input tests check pure queue operations. Native login lifecycle tests check signal cancellation and listener cleanup. Compiler tests reject invalid command payloads, missing required parsed flags and mutation of domain input views.

The CLI's stable contracts are string IDs, queue schema version 1, JSON envelopes, error codes and exit codes. Credentials travel only through private helper pipes and native protected storage. Preserve existing unlocks, preview by default, validate the whole queue before a write, and never automatically retry an achievement POST.

JSON is selected explicitly with `--json`, including for piped output. Text errors go to stderr; JSON errors remain on stdout. Preserve both formats and the per-achievement reports.

Native callback and credential self-tests run during `build`. Both helpers run the same embedded JSON protocol cases; the macOS build embeds these without a runtime file dependency. Windows builds also check the real WebView2 loader and installed browser runtime. The Windows callback/config tests can also run on macOS with `dotnet run --project native/windows-tests/Gog.Login.Tests.csproj --configuration Release`. Windows storage and packaged execution need a Windows runner. Browser sign-in needs a human on the target OS.

After a native build, run `npm run test:update-flow` to test the packaged CLI against a local release server. It checks confirmation, downloads, checksum rejection, executable replacement, backup and queue preservation, and login update notices. It uses an isolated fixture entry and makes no GOG requests. CI runs this test for each native target.

Update archives stream to a temporary file with incremental SHA-256 validation before extraction. Small release metadata stays buffered. Archive transfers have a five-minute total deadline and a 30-second inactivity limit. Cleanup failures preserve the install or rollback result and report the remaining temporary paths; a failed rollback retains its recovery lock and backup.

## Commits and releases

Use Conventional Commits: `feat:` for features, `fix:` for fixes, and `refactor:` or `perf:` for code changes. Use `ci:`, `chore:`, `docs:` and `test:` for maintenance that does not require a release by itself. Use the same format for PR titles when squash merging.

Release Please updates a release PR with the version and changelog. When that PR merges, it creates a draft release and tag. The release workflow checks out that tag, reruns all checks and builds four distributions. It verifies the version, complete artifact set and SHA-256 hashes, uploads the files, then publishes the release. A failed build leaves the release in draft form.

CI is dispatched explicitly for Release Please PRs so no personal access token is required. Repository Settings → Actions → General must permit GitHub Actions to create pull requests. To retry a failed draft release, run the **Release** workflow with its existing tag.

Mac executables use ad hoc signing; Windows executables are unsigned. Developer ID signing, Apple notarization and Windows code signing are not configured. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled runtime licenses.
