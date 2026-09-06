#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { runCli } from './i18n-ai/cli.mjs';

try {
	await runCli(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
