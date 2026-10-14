# Project instructions

- This project restores earned GOG achievements. The first release is a Mac CLI; Electron is a later phase.
- Use Node 22 or later. The only runtime package is the native Keychain binding.
- Keep `src/service.mjs` independent of the CLI and Electron so both can use the same behavior.
- Commands return one JSON object on stdout. Preserve string IDs, error codes, exit codes and queue schema version 1.
- Login codes and tokens must not appear in arguments, files, logs, reports or chat. Store credentials in Mac Keychain. Automatic login captures GOG's registered callback in a controlled, nonpersistent native WebKit window. Its private IPC response must never reach CLI stdout. Manual input uses stdin or the explicit clipboard command.
- GOG rejects custom loopback redirects for the Galaxy OAuth client. Keep the exact registered redirect URL when opening sign-in and exchanging the code.
- `auth login` must complete sign-in in one command. Always close its helper window after success, cancellation, timeout or failure. Keep progress on stderr and the final JSON on stdout.
- Queue creation and edits make no achievement writes. Apply previews by default; `--yes` is required for writes.
- Validate the entire queue, account and game before any write. Never send a null unlock date.
- Preserve existing unlocks. Do not add reset or relock commands without an explicit request.
- Tests use fixtures and local HTTP servers. Do not make automated achievement writes against a real account.
- Run `npm run check` and `npm test` after code changes. Do not repeat checks without a new change or failure.
- After native auth source changes, run `npm run build:mac`. The helper's self-test validates callback parsing without sign-in; the build produces an Apple Silicon and Intel binary.
- Before work in an existing checkout, use main and pull the latest changes unless the task needs another branch. This new repository has no remote yet.
- Keep tool waits bounded to 30 seconds and provide short progress updates.

## AI workflow

Use `node bin/gog-achievements.mjs --help` for command details. Read `README.md` before login or apply.
Start with `doctor` and `auth status`. A human must complete browser sign-in locally.
Use `games list`, then `achievements list`. Queue only achievements the user says they earned.
Show the queue and a dry run before applying selected changes within the user's authorization.
Inspect each apply result. Exit 6 means partial or unconfirmed results, not a completed batch.
