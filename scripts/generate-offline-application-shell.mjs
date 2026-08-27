#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { generateOfflineApplicationShell } from './lib/offline-application-shell.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const outputRoot = resolve(process.argv[2] || 'dist');

generateOfflineApplicationShell({ outputRoot, repositoryRoot }).then(({ assetCount, releaseIds }) => {
	const shells = Object.entries(releaseIds).map(([productId, releaseId]) => `${productId} ${releaseId}`);
	console.log(
		`Generated offline application shells ${shells.join(' and ')} `
		+ `with ${String(assetCount)} verified assets.`,
	);
}).catch((error) => {
	console.error(`Offline application shell generation failed: ${error.message}`);
	process.exitCode = 1;
});
