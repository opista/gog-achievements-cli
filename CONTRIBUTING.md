# Contributing

Use the Node version in `.node-version`, run `npm ci --ignore-scripts`, then:

```sh
npm run check
npm run test:coverage
npm run build
```

Use `npm run build -- --target TARGET` to select `macos-arm64`, `macos-x64`, `windows-arm64` or `windows-x64`. Run the build on that OS with matching Node architecture. Use `npm run build -- --help` for details. The default is the current OS and Node architecture; other targets' output files are kept.

`check` compiles strict TypeScript, checks application and JavaScript tooling types, then runs syntax, ESLint and Prettier checks. `npm run compile` emits application code, tests and tooling under `.build/typescript/`; tests run that emitted code. Use `npm run format` to format changes. Coverage must meet 95% lines, 85% branches and 90% functions for `src/`. Tests use fixtures, temporary files and a local HTTP server. They never write achievements to a real GOG account.

## Code map

| File                        | Responsibility                                                      |
| --------------------------- | ------------------------------------------------------------------- |
| `src/cli.mts`               | Parse and validate commands.                                        |
| `src/help.mts`              | Command definitions, flags and help.                                |
| `src/output.mts`            | Human text and JSON rendering.                                      |
| `src/service.mts`           | Account checks, queue planning and achievement restoration.         |
| `src/api.mts`               | GOG requests, paging and response validation.                       |
| `src/data.mts`              | String IDs, UTC dates, queue files and locks.                       |
| `src/keychain.mts`          | Shared credential protocol with platform-specific storage settings. |
| `src/native-login.mts`      | Capture native login results and validate OAuth state.              |
| `src/process.mts`           | Private native IPC, cancellation, byte limits and deadlines.        |
| `src/assets.mts`            | Load and verify bundled native helpers.                             |
| `native/gog-login.swift`    | macOS WebKit sign-in and Keychain access.                           |
| `native/windows/`           | Windows WebView2 sign-in and DPAPI storage.                         |
| `scripts/build.mjs`         | Package and smoke-test the selected target's distribution.          |
| `scripts/build-targets.mjs` | Shared target definitions and build argument validation.            |

The app compiler rejects JavaScript application imports. The build configuration includes checked JavaScript tooling so its declarations and emitted paths are available to tests. Keep boundary input `unknown` until validation. The fixture contract snapshots preserve the JavaScript baseline, including exact text/JSON, queue bytes and request order.

Keep account operations in the service and HTTP details in the API. Output code must not perform network calls. Add tests for behaviour and failure paths; avoid tests that only copy an implementation.

The CLI's stable contracts are string IDs, queue schema version 1, JSON envelopes, error codes and exit codes. Credentials travel only through private helper pipes and native protected storage. Preserve existing unlocks, preview by default, validate the whole queue before a write, and never automatically retry an achievement POST.

Native callback and credential self-tests run during `build`. Windows builds also check the real WebView2 loader and installed browser runtime. The Windows callback/config tests can also run on macOS with `dotnet run --project native/windows-tests/Gog.Login.Tests.csproj --configuration Release`. Windows storage and packaged execution need a Windows runner. Browser sign-in needs a human on the target OS.

## Commits and releases

Use Conventional Commits: `feat:` for features, `fix:` for fixes, and `refactor:` or `perf:` for code changes. Use `ci:`, `chore:`, `docs:` and `test:` for maintenance that does not require a release by itself. Use the same format for PR titles when squash merging.

Release Please updates a release PR with the version and changelog. When that PR merges, it creates a draft release and tag. The release workflow checks out that tag, reruns all checks and builds four distributions. It verifies the version, complete artifact set and SHA-256 hashes, uploads the files, then publishes the release. A failed build leaves the release in draft form.

CI is dispatched explicitly for Release Please PRs so no personal access token is required. Repository Settings → Actions → General must permit GitHub Actions to create pull requests. To retry a failed draft release, run the **Release** workflow with its existing tag.
