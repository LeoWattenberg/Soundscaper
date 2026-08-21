#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { generateReferenceDocuments } from './lib/docs-reference-generator.mjs';

const allowedArguments = new Set(['--check']);
const unknownArguments = process.argv.slice(2).filter((argument) => !allowedArguments.has(argument));
if (unknownArguments.length > 0) {
	console.error(`Unknown documentation reference option: ${unknownArguments.join(', ')}.`);
	process.exitCode = 1;
} else {
	const checkOnly = process.argv.includes('--check');
	const repositoryRoot = resolve(import.meta.dirname, '..');
	try {
		const { stale, documentCount } = await generateReferenceDocuments(repositoryRoot, { write: !checkOnly });
		if (stale.length === 0) {
			console.log(`Documentation references are current (${String(documentCount)} documents).`);
		} else if (checkOnly) {
			console.error(`Stale documentation references: ${stale.join(', ')}. Run \`node scripts/docs-reference.mjs\`.`);
			process.exitCode = 1;
		} else {
			console.log(`Generated ${String(stale.length)} changed documentation reference document(s): ${stale.join(', ')}.`);
		}
	} catch (error) {
		console.error(`Documentation reference generation failed: ${error.message}`);
		process.exitCode = 1;
	}
}
