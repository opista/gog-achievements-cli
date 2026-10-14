import { runCLI } from './cli.mjs';
import { formatOutput } from './output.mjs';

export async function main(args = process.argv.slice(2)) {
  const outcome = await runCLI(args);
  const output = outcome.format === 'text' && !outcome.result.ok ? process.stderr : process.stdout;
  output.write(formatOutput(outcome, { columns: process.stdout.columns }));
  process.exitCode = outcome.exitCode;
}
