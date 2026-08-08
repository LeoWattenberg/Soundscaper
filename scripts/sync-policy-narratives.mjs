#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { syncPolicyNarratives } from './lib/policy-narratives.mjs';

const checkOnly = process.argv.includes('--check');
try {
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const { stale, narrativeCount } = await syncPolicyNarratives(repositoryRoot, { write: !checkOnly });
	if (stale.length === 0) {
		console.log(`Policy narratives are in sync (${narrativeCount} bound blocks).`);
	} else if (checkOnly) {
		console.error(`Stale policy narratives: ${stale.join(', ')}; run \`node scripts/sync-policy-narratives.mjs\`, then repin the runtime evidence.`);
		process.exitCode = 1;
	} else {
		console.log(`Rewrote ${stale.length} policy narrative block(s): ${stale.join(', ')}. Run \`node scripts/repin-runtime-evidence.mjs\` before committing.`);
	}
} catch (error) {
	console.error(`Policy narrative sync failed: ${error.message}`);
	process.exitCode = 1;
}
