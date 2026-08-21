#!/usr/bin/env node

import { runCli } from './docs-ai/cli.mjs';

try {
	await runCli(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
