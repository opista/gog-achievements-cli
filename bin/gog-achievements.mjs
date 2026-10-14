#!/usr/bin/env node
import { runCLI } from '../src/cli.mjs';
import { formatOutput } from '../src/output.mjs';

const outcome = await runCLI(process.argv.slice(2));
const output = outcome.format === 'text' && !outcome.result.ok ? process.stderr : process.stdout;
output.write(formatOutput(outcome, { columns: process.stdout.columns }));
process.exitCode = outcome.exitCode;
