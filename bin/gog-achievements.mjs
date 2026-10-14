#!/usr/bin/env node
import { runCLI } from '../src/cli.mjs';

const { result, exitCode, pretty } = await runCLI(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : undefined)}\n`);
process.exitCode = exitCode;
