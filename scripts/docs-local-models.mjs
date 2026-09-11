#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { generateLocalModelTestDocuments } from './lib/local-model-test-docs.mjs';

const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
if (unknown.length > 0) {
	console.error(`Unknown local model documentation option: ${unknown.join(', ')}.`);
	process.exitCode = 1;
} else {
	const write = !process.argv.includes('--check');
	try {
		const result = await generateLocalModelTestDocuments(resolve(import.meta.dirname, '..'), { write });
		if (result.stale.length > 0 && !write) {
			console.error(`Stale local model documentation: ${result.stale.join(', ')}. Run node scripts/docs-local-models.mjs.`);
			process.exitCode = 1;
		} else {
			console.log(`Local model documentation ${write ? 'generated' : 'current'} (${String(result.documentCount)} pages).`);
		}
	} catch (error) {
		console.error(`Local model documentation failed: ${error.message}`);
		process.exitCode = 1;
	}
}
