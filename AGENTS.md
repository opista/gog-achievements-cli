# Project instructions

- This project is a standalone CLI for macOS and Windows for restoring earned GOG achievements.
- Use Node 22 or later. Release executables bundle Node and native helpers; runtime packages are not required. Use Node 24 LTS for release builds.
- Keep `src/service.mts` independent of CLI parsing and output formatting. External applications consume the CLI through its JSON contract; do not add application-specific plans or dependencies here.
- Commands show readable text by default. Use `--json` for one compact JSON object on stdout; add `--pretty` for indentation. Preserve string IDs, error codes, exit codes and queue schema version 1. In text mode, errors go to stderr.
- Login codes and plaintext tokens must not appear in arguments, files, logs, reports or chat. Store credentials in Mac Keychain or a Windows CurrentUser DPAPI-encrypted file with a user-only ACL. Automatic login captures GOG's registered callback in a controlled native window (nonpersistent WebKit on Mac, InPrivate WebView2 on Windows). Its private IPC response must never reach CLI stdout. Manual input uses stdin or the explicit clipboard command.
- GOG rejects custom loopback redirects for the Galaxy OAuth client. Keep the exact registered redirect URL when opening sign-in and exchanging the code.
- `auth login` must complete sign-in in one command. Always close its helper window after success, cancellation, timeout or failure. Keep progress on stderr and the final result on stdout.
- Queue creation and edits make no achievement writes. Apply previews by default; `--yes` is required for writes.
- Validate the entire queue, account and game before any write. Never send a null unlock date.
- Preserve existing unlocks. Do not add reset or relock commands without an explicit request.
- Tests use fixtures and local HTTP servers. Do not make automated achievement writes against a real account.
- Run `npm run check` and `npm run test:coverage` after code changes. Do not repeat checks without a new change or failure.
- Run `npm run build` for the current OS and Node architecture, or `npm run build -- --target TARGET` to select it explicitly. The target must match the OS and running Node architecture; reject mismatches before file changes. Preserve other targets' output. After native changes, build and run the callback self-test. Mac helpers are universal; Windows helpers use the selected architecture. Do not claim Windows behavior is verified from a Mac compilation alone.
- Keep native credential reads bounded. Background Keychain reads must not open approval dialogs; explicit sign-in can allow 30 seconds for local Keychain permission. Validate cached helper bytes before executing them.
- Release Please creates version/changelog PRs from Conventional Commits. When merged, its draft release stays unpublished until all native CI builds and tests pass and all archives/checksums are attached. Build the exact release tag; never publish assets from a different commit. Signing and notarization are not yet configured.
- Before work in an existing checkout, use main and pull the latest changes unless the task needs another branch. The remote is `git@github.com:metacurb/gog-achievements-cli.git`.
- Keep tool waits bounded to 30 seconds and provide short progress updates.

## AI workflow

Use `node bin/gog-achievements.mjs --help --json` for command details. Read `README.md` before login or apply.
Use `--json` for AI and script calls. Start with `doctor` and `auth status`. A human must complete browser sign-in locally.
Use `games list`, then `achievements list`. Queue only achievements the user says they earned.
Show the queue and a dry run before applying selected changes within the user's authorization.
Inspect each apply result. Exit 6 means partial or unconfirmed results, not a completed batch.
