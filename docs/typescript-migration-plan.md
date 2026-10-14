# GOG Achievements CLI TypeScript Migration Plan

14 October 2026. Based on the [migration report](/Users/beau/Documents/projects/gog-achievements-cli/docs/typescript-migration-report.md) and source commit `a102216760b555b2a864ed18c853f256ef484920`.

Migrate the CLI to strict TypeScript, preserve its public behaviour, then separate pure rules from external operations. Deliver this in two stages. Each stage must pass its checks before it can merge. This plan covers application code, tests, fixtures, source execution and packaging.

The report baseline is 87 passing tests, with 98.28% line, 91.28% branch and 96.36% function coverage. Refresh that baseline when implementation starts. This planning step changes documentation only.

## Implementation decisions

- Use `.mts` for application source, tests and fixtures. Emit `.mjs` with NodeNext module resolution and explicit relative import extensions.
- Use `.build/typescript/` as the ignored compiler output root. Mirror the source and test paths. Keep native target staging under its existing separate paths.
- Compile before running application code. Run tests on emitted JavaScript with the existing Node test runner. Keep esbuild for the standalone CommonJS bundle.
- Keep `bin/gog-achievements.mjs` and `src/index.mjs` as small compatibility entries. Preserve existing named exports, callable methods and dependency injection options. Publish matching type declarations through the package exports.
- Retain build, check, test, demo and release scripts as JavaScript in this scope. Check them with TypeScript and JSDoc in a separate configuration. Keep ESLint configuration as JavaScript. This preserves build argument validation and the release verifier's independent execution.
- Add development dependencies only: TypeScript, Node type definitions and compatible TypeScript ESLint support. Pin exact compatible versions. Keep the current runtime requirements and production dependency count.
- Keep the existing validators and error handling. Decode external data as `unknown`, then validate it. Preserve accepted inputs, coercions, error messages and validation order.
- Keep the public CLI, JSON and queue contracts. Preserve the Swift and C# helpers, their protocols, credential identities and distribution layouts.

The new source setup requires an explicit compile step after `npm ci --ignore-scripts`. Document it. Installed executables continue to contain their runtime and helper.

## Target module structure

```text
src/
  index.mjs                 Compatibility export entry
  index.mts                 Typed public exports
  main.mts                  Entry point and dependency wiring
  service.mts               Public service facade with compatible defaults
  cli.mts                   Public runCLI facade with compatible defaults
  runtime-paths.mts         Central runtime path resolution
  version.mts               Version from package metadata
  domain/
    values.mts              IDs and date rules
    queue.mts               Queue validation and pure transformations
    restoration.mts         Pure restoration planning and result rules
    errors.mts              Domain errors and safe public error data
  application/
    ports.mts               API and credential dependency interfaces
    session.mts             Login, refresh, caching and logout
    service.mts             Dependency-injected application use cases
  adapters/
    json.mts                Existing JSON parser that preserves large IDs
    gog-api.mts              HTTP, paging and response validation
    queue-files.mts          Files, atomic saves and lock transactions
    input.mts                Stdin and clipboard operations
    native/                 Process, assets, credential and login modules
  cli/
    contracts.mts           Commands and command-specific outcomes
    definitions.mts         Shared command, flag and help definitions
    parse.mts               Pure argument validation
    handlers.mts            Dispatch and command orchestration
    output.mts              Pure text and JSON formatting
```

Use interfaces at actual dependency boundaries. Keep types with their owning modules. Domain functions receive data and time explicitly. They return new queue values and perform no filesystem, process or network operations. Preserve sequential loops where write order matters.

ESLint must enforce the dependency direction: domain modules are independent of application, adapters and CLI; application modules depend on domain and ports; adapters implement ports; handlers and the entry point connect them. Keep default production dependencies in the entry point and root compatibility facades. Application implementations receive their dependencies explicitly. Keep the facades small and preserve existing public constructors and functions.

## Tasks and dependencies

| ID   | Task                                              | Depends on | Completion check                                                          |
| ---- | ------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| TS01 | Capture behaviour and public contracts            | None       | Baseline scenarios, output, files and request effects are reproducible.   |
| TS02 | Establish strict compilation and runtime paths    | TS01       | Emitted ESM, version metadata, entry points and helper path tests pass.   |
| TS03 | Migrate application modules and tests             | TS02       | Strict types, typed boundaries and all baseline scenarios pass.           |
| TS04 | Complete packaging and verify stage one           | TS03       | Source installation, current native build and four target CI checks pass. |
| TS05 | Extract domain rules and file storage             | TS04       | Pure queue operations and file transactions preserve behaviour.           |
| TS06 | Separate session, CLI and native responsibilities | TS04       | Typed orchestration and adapters preserve behaviour.                      |
| TS07 | Integrate architecture and enforce boundaries     | TS05, TS06 | Import rules, public facade and full compatibility checks pass.           |
| TS08 | Verify distribution and update documentation      | TS07       | Final local checks, all native CI checks and documentation are complete.  |

TS05 and TS06 have separate logical dependencies. Coordinate changes to shared imports when integrating them. TS02 through TS04 form one complete TypeScript delivery; do not merge a partially converted execution path.

## Stage one Strict TypeScript with matching behaviour

**TS01 Capture behaviour and public contracts**

Run `npm run check`, `npm run test:coverage` and `npm run demo` on the implementation base. Capture deterministic fixture expectations for all 14 commands, help, output modes and representative errors. Record exact stdout/stderr, exit codes, queue file bytes, request sequence and write count. Freeze time where needed and normalize only known temporary paths.

Add focused checks for the public export entry and constructor options. Cover safe numeric ID inputs, large IDs, nullable observed dates, strict queue fields, all restoration statuses and cancellation. Preserve the existing tests. Use synthetic sessions; saved traces must omit credentials, private helper messages and credential-bearing URLs.

Use the baseline commit to obtain comparison evidence without changing the original implementation. Compare effects as well as returned JSON. Store only fixture expectations needed for regression tests; keep the original implementation in Git.

**TS02 Establish strict compilation and runtime paths**

Add an application compiler configuration with `allowJs: false`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `noEmitOnError`, JSON module support, declarations and source maps. Use a fixed JavaScript target compatible with Node 22. Add a separate `checkJs` configuration for retained tooling.

Add `compile`, `typecheck` and `typecheck:tooling` commands. Update ESLint for typed source, unsafe values, floating promises and exhaustive handling. Disable JavaScript rules only where the TypeScript equivalent replaces them. Prove the compiler and Node type versions work with the existing ESLint version before pinning them.

Establish one runtime path resolver. Test the emitted source tree, source installation, SEA assets and Intel Mac private runtime layout. Ensure emitted version code can read the correct package metadata. Avoid dependence on the caller's working directory.

**TS03 Migrate application modules and tests**

Convert the existing modules before moving their responsibilities. Start with errors, values and boundary types; then API and native operations; then the service, command definitions, dispatch and output. Convert fixtures and tests to `.mts`. Use runtime validation for malformed fixture inputs instead of weakening their types.

Define separate internal credential data and public payloads. Type queue schema `1`, achievement states and all seven apply statuses. Tie each parsed command to its success payload. Model failures that occur before a command is recognized. Keep optional fields and null values consistent with the current contract.

Declare API and credential interfaces from the operations the service uses. Type the injected clock, wait function, process runner and test doubles. Keep unvalidated metadata fields as `unknown`. Add compiler tests that reject wrong command payloads and null requested unlock dates. Limit expected compiler errors to those deliberate tests.

Replace flat test discovery with recursive discovery of emitted tests. Fail if none are found. Confirm every baseline scenario still runs. Configure coverage for all emitted application modules and check source-map attribution. Add a public-entry import test so the export module is measured too.

**TS04 Complete packaging and verify stage one**

Connect the compatibility entries, demo and standalone bundle to the emitted application. Include runtime files, version metadata and declarations in source packages. Exclude tests and development-only fixtures from installed runtime packages. Verify installation from a temporary package with lifecycle scripts disabled.

Make `check` run compilation, tooling type checks, syntax/JSON checks, lint and formatting. Make test and demo commands compile their required inputs explicitly. Keep `build --help` and invalid target handling before any compilation or output cleanup. Do not add a `prebuild` hook that writes files before target validation.

After a valid target is selected, make `build` enforce type checking and compilation before bundling. Preserve other targets' artifacts. Keep the existing CommonJS banner, SEA assets, native launcher, metadata and checksum rules. Keep `scripts/verify-release.mjs` runnable in the publish job's fresh checkout without installed development packages.

Run a Node 22 compatibility smoke check on emitted runtime code. Run the current native build and require the existing four target CI jobs. At this review point, confirm that the CLI is fully typed, behaviour matches the baseline, and release packaging works. Merge this stage before the architecture refactor.

## Stage two Separate rules from external operations

**TS05 Extract domain rules and file storage**

Move ID/date rules, queue validation, selection, edits and restoration planning into domain functions. Pass the current time explicitly while preserving the ten-second offset and second precision. Retain existing error precedence and accepted date formats.

Move JSON decoding, queue reading, atomic save/create and lock handling into adapters. Keep the lock around the complete existing transaction, including apply and its remote operations. Preserve permissions, overwrite protection and cleanup on failure. Test that input queue objects remain unchanged after pure transformations.

**TS06 Separate session, CLI and native responsibilities**

Extract session validation, login completion, refresh, caching and logout into a focused application module. Keep account and game-scoped credentials distinct. Keep ownership checks and the ordered restoration workflow in the service. Preserve callable methods through the existing facade.

Separate parsing from handlers and rendering. Keep one source for command and flag definitions. Move stdin and clipboard access to the input adapter. Keep native window/process lifecycle handling together, including signal registration, removal, timeouts and cancellation.

Move the existing native modules as cohesive units. Preserve private IPC, storage identity, bounded credential access, helper hashes and error masking. Share constants only where they express the same policy. Do not change timeout values or retry rules during extraction.

**TS07 Integrate architecture and enforce boundaries**

Apply import restrictions to the new folders. Confirm pure modules have no external effects. Check that formatting functions receive the correct command payload without broad casts. Keep internal sessions and client secrets out of public projections.

Run all baseline comparisons after integration. Exercise partial apply, a lost POST response, date mismatch, concurrent unlock, queue conflicts, malformed input and cancellation. Assert request order, lock lifetime and one POST per attempted achievement. Check desktop-facing fixture payloads against its documented schemas without adding an app source dependency.

## Final verification and release readiness

**TS08 Verify distribution and update documentation**

| Area               | Required evidence                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static checks      | Strict application compilation, checked JavaScript tooling, import rules, ESLint and formatting pass.                                                               |
| Behaviour          | All existing scenarios and focused compatibility tests pass. CLI, public exports, output streams, errors and queue bytes match the baseline.                        |
| Coverage           | At least 95% lines, 85% branches and 90% functions. Review reductions from the report baseline and inspect the complete measured file list.                         |
| Native integration | Current OS/architecture build passes; all four target CI jobs pass their native self-tests and executable smoke checks outside the checkout.                        |
| Packaging          | Source installation contains emitted runtime files and declarations. Archives, metadata, helper lookup, checksums and version/tag validation pass.                  |
| Documentation      | Update README setup commands, CONTRIBUTING code map and AGENTS paths. Preserve their existing safety and release rules. Record the evidence from the tested commit. |

Run `npm run check`, `npm run test:coverage`, `npm run demo` and the matching native build after the final code change. Repeat checks only for new changes, failures or unresolved concerns. Report platform checks as pending until their actual runner results are available. Live browser sign-in and real server date limits remain separate manual checks.

## Delivery and rollback

Use two reviewed PRs: `refactor: migrate CLI to strict TypeScript`, then `refactor: separate CLI domain rules and adapters`. Keep every intermediate merge runnable and all four native targets green. Avoid unrelated fixes in these PRs; record any discovered behaviour change separately.

Release only through the existing draft-release workflow after the final checks pass. Preserve queue schema `1` and credential identities so existing local data remains compatible. If a stage must be reverted before release, revert that stage's changes and rerun its checks. Keep the prior release available; do not overwrite its assets.

Implementation is complete when both stages meet their completion checks and the final report names the tested commit, confirms contract preservation and lists any remaining manual checks.
