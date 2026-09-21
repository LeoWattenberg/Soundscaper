/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	collectApplicationDesktopRuntimeReferences,
	collectDesktopProductRuntimeClosure,
} from '../scripts/lib/desktop-product-runtime-staging.mjs';

test('desktop runtime reachability follows literal joined roots and import-meta URL edges', async (context) => {
	const root = await fixtureRoot(context);
	const applicationRoot = join(root, 'application');
	const compiledRoot = join(root, 'runtime');
	await mkdir(join(compiledRoot, 'desktop'), { recursive: true });
	await mkdir(applicationRoot, { recursive: true });
	await writeFile(join(applicationRoot, 'main.mjs'), `
import { join } from 'node:path';
export const helper = join(
	import.meta.dirname,
	'project-library-runtime',
	'desktop',
	'root.js',
);
await import('#desktop-runtime/alias');
`);
	await writeFile(join(compiledRoot, 'desktop/root.js'), `
import './static.js';
export const worker = new URL('./worker.js', import.meta.url);
`);
	await writeFile(join(compiledRoot, 'desktop/static.js'), 'export const value = true;\n');
	await writeFile(join(compiledRoot, 'desktop/worker.js'), 'export const worker = true;\n');
	await writeFile(join(compiledRoot, 'desktop/alias.js'), 'export const alias = true;\n');
	const completeFiles = [
		'desktop/alias.js', 'desktop/root.js', 'desktop/static.js', 'desktop/worker.js',
	];
	const roots = await collectApplicationDesktopRuntimeReferences({
		applicationRoot,
		applicationFiles: ['main.mjs'],
		completeFiles,
		runtimePackageImports: {
			'#desktop-runtime/alias': './desktop/project-library-runtime/desktop/alias.js',
		},
	});
	assert.deepEqual(roots, ['desktop/alias.js', 'desktop/root.js']);
	assert.deepEqual(await collectDesktopProductRuntimeClosure({
		compiledRoot,
		completeFiles,
		rootFiles: roots,
		productId: 'framescaper',
	}), completeFiles);
});

test('desktop runtime reachability rejects nonliteral loader authority', async (context) => {
	const root = await fixtureRoot(context);
	const applicationRoot = join(root, 'application');
	const compiledRoot = join(root, 'runtime');
	await mkdir(join(compiledRoot, 'desktop'), { recursive: true });
	await mkdir(applicationRoot, { recursive: true });
	await writeFile(join(applicationRoot, 'main.mjs'), `
import { join } from 'node:path';
export const helper = join(import.meta.dirname, 'project-library-runtime', dynamicPath);
`);
	await assert.rejects(() => collectApplicationDesktopRuntimeReferences({
		applicationRoot,
		applicationFiles: ['main.mjs'],
		completeFiles: ['desktop/root.js'],
	}), /nonliteral desktop runtime loader/iu);

	for (const expression of ['workerPath', "resolve(workerPath, 'worker.js')"]) {
		await writeFile(join(compiledRoot, 'desktop/root.js'), `
export const worker = new URL(${expression}, import.meta.url);
`);
		await assert.rejects(() => collectDesktopProductRuntimeClosure({
			compiledRoot,
			completeFiles: ['desktop/root.js'],
			rootFiles: ['desktop/root.js'],
			productId: 'framescaper',
		}), /nonliteral import-meta URL/iu);
	}
});

async function fixtureRoot(context) {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-reachability-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}
