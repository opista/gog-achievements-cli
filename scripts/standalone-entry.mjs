import { main } from '../src/main.mjs';
main().catch(() => {
  process.stderr.write('The CLI could not start. Download a fresh executable and retry.\n');
  process.exitCode = 7;
});
