/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { OutputChunk } from 'rolldown';
import { build } from 'vite';
import { workerChunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('Motion lazy raster dependencies cannot import the preview worker registration entry', async () => {
	const root = resolve(import.meta.dirname, '..');
	const directory = await mkdtemp(resolve(tmpdir(), 'motionscaper-worker-chunks-'));
	const input = resolve(directory, 'preview.mjs');
	const worker = resolve(root, 'src/common/editor/motion-preview-worker.ts');
	const chunks: OutputChunk[] = [];
	try {
		await writeFile(input, `globalThis.preview = new Worker(new URL(${JSON.stringify(worker)}, import.meta.url), { type: 'module' });`);
		// Exercise Vite's actual module-worker emission with the maintained source
		// graph, lazy CanvasKit loader and production worker splitting constraints.
		await build({
			configFile: false, root, publicDir: false, logLevel: 'silent',
			worker: {
				format: 'es',
				plugins: () => [{ name: 'capture-motion-worker-chunks', generateBundle(_options, bundle) {
					for (const output of Object.values(bundle)) if (output.type === 'chunk') chunks.push(output);
				} }],
				rolldownOptions: { output: { strictExecutionOrder: true, codeSplitting: { groups: workerChunkGroups, minSize: 20_000 } } },
			},
			build: { write: false, rolldownOptions: { input }, emptyOutDir: false },
		});
		const entry = chunks.find(chunk => chunk.facadeModuleId === worker);
		assert.ok(entry?.isEntry, 'the production worker must have one executable registration entry');
		assert.equal(chunks.filter(chunk => chunk.facadeModuleId === worker).length, 1);
		const raster = chunks.find(chunk => Object.keys(chunk.modules).some(id => id.endsWith('/motion-canvaskit-browser.ts')));
		assert.ok(raster?.isDynamicEntry, 'CanvasKit must remain lazy');
		assert.notEqual(raster.fileName, entry.fileName);
		const visited = new Set<string>();
		const visit = (chunk: OutputChunk): void => {
			assert.notEqual(chunk.fileName, entry.fileName, 'shared lazy dependencies must never execute the worker registration entry again');
			if (visited.has(chunk.fileName)) return;
			visited.add(chunk.fileName);
			for (const dependency of chunk.imports) {
				const imported = chunks.find(candidate => candidate.fileName === dependency);
				assert.ok(imported, `worker dependency ${dependency} must be emitted`);
				visit(imported);
			}
		};
		for (const chunk of chunks) if (chunk !== entry) visit(chunk);
		assert.deepEqual(entry.exports, [], 'a registration entry must not also own shared library exports');
		for (const module of ['sha2.js', 'utils.js']) {
			const owner = chunks.find(chunk => Object.keys(chunk.modules).some(id => id.endsWith(`/node_modules/@noble/hashes/${module}`)));
			assert.ok(owner?.fileName.includes('vendor-hashes-worker'), `${module} has a separate semantic worker owner`);
		}
		for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk.code) <= 500_000, `${chunk.fileName} respects the unchanged production ceiling`);
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('Motion shared worker hashing has a bounded non-recursive owner even below the global chunk threshold', () => {
	const owner = workerChunkGroups.find(group => group.name === 'vendor-hashes-worker');
	assert.ok(owner?.test instanceof RegExp);
	assert.equal(owner.includeDependenciesRecursively, false);
	assert.equal(owner.minSize, 0);
	assert.equal(owner.maxSize, 400_000);
	for (const path of ['node_modules/@noble/hashes/sha2.js', 'node_modules/@noble/hashes/utils.js', 'node_modules\\@noble\\hashes\\_md.js']) assert.equal(owner.test.test(path), true);
	for (const path of ['src/common/editor/motion-preview-worker.ts', 'src/common/editor/motion-canvaskit-browser.ts', 'node_modules/canvaskit-wasm/bin/canvaskit.js']) assert.equal(owner.test.test(path), false);
});
