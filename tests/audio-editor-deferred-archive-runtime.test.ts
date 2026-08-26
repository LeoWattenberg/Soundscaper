/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createDeferredArchiveRuntime,
	type DeferredArchiveModuleLoaders,
} from '../src/common/editor/controller/deferred-archive-runtime.ts';

test('archive implementations stay unloaded until their existing actions run and are cached', async () => {
	const calls = { aup4: 0, legacy: 0, scape: 0, copy: 0 };
	const clientCalls: Array<readonly [string, ...unknown[]]> = [];
	const loaders = {
		aup4: async () => {
			calls.aup4 += 1;
			return {
				createAup4Client: (options: unknown) => ({
					initialize: async () => { clientCalls.push(['initialize', options]); return { opfs: true }; },
					create: async (...args: unknown[]) => { clientCalls.push(['create', ...args]); },
					openFile: async (...args: unknown[]) => { clientCalls.push(['openFile', ...args]); return {}; },
					decode: async (...args: unknown[]) => { clientCalls.push(['decode', ...args]); return { project: {}, sources: [] }; },
					writeSnapshot: async (...args: unknown[]) => { clientCalls.push(['writeSnapshot', ...args]); return {}; },
					commit: async (...args: unknown[]) => { clientCalls.push(['commit', ...args]); },
					export: async (...args: unknown[]) => { clientCalls.push(['export', ...args]); return {}; },
					inspect: async (...args: unknown[]) => { clientCalls.push(['inspect', ...args]); return {}; },
					close: async (...args: unknown[]) => { clientCalls.push(['close', ...args]); },
					dispose: () => { clientCalls.push(['dispose']); },
				}),
				requestAup4FileHandle: async (options: unknown) => ({ options }),
				saveAup4Result: async (result: unknown, options: unknown) => ({ result, options }),
			};
		},
		legacy: async () => {
			calls.legacy += 1;
			return {
				decodeLegacyAupProject: async (file: unknown) => ({ file, decoded: true }),
				convertLegacyAupToProject: (structure: unknown) => ({ structure, converted: true }),
			};
		},
		scape: async () => {
			calls.scape += 1;
			return {
				inspectScapeProject: async (...args: unknown[]) => ({ operation: 'inspect', args }),
				importScapeProject: async (...args: unknown[]) => ({ operation: 'import', args }),
				exportScapeProject: async (...args: unknown[]) => ({ operation: 'export', args }),
			};
		},
		copy: async () => {
			calls.copy += 1;
			return {
				copyFutureScapeArchive: async (...args: unknown[]) => ({ operation: 'copy', args }),
			};
		},
	} as unknown as DeferredArchiveModuleLoaders;
	const runtime = createDeferredArchiveRuntime(loaders);
	const client = runtime.createAup4Client({ worker: 'fixture' });

	assert.deepEqual(calls, { aup4: 0, legacy: 0, scape: 0, copy: 0 });
	assert.deepEqual(await client.initialize(), { opfs: true });
	await client.create('project-1');
	assert.equal(calls.aup4, 1);
	assert.deepEqual(clientCalls.slice(0, 2), [
		['initialize', { worker: 'fixture' }],
		['create', 'project-1'],
	]);

	assert.deepEqual(await runtime.decodeLegacyAupProject('legacy.aup', []), {
		file: 'legacy.aup',
		decoded: true,
	});
	assert.deepEqual(await runtime.convertLegacyAupToProject({ tracks: [] }), {
		structure: { tracks: [] },
		converted: true,
	});
	assert.equal(calls.legacy, 1);

	const retention = { retain() {} };
	assert.deepEqual(await runtime.inspectScapeProject('project.scape', null, {}, retention), {
		operation: 'inspect', args: ['project.scape', null, {}, retention],
	});
	await runtime.importScapeProject('project.scape', {}, {});
	await runtime.exportScapeProject({}, {}, {});
	assert.equal(calls.scape, 1);
	await runtime.copyFutureScapeArchive(new Blob(), () => {}, {});
	assert.equal(calls.copy, 1);
});

test('archive loader failures preserve the original rejection', async () => {
	const failure = new Error('archive loader failed');
	const runtime = createDeferredArchiveRuntime({
		scape: async () => { throw failure; },
	} as Partial<DeferredArchiveModuleLoaders>);

	await assert.rejects(runtime.importScapeProject(new Blob(), {}, {}), (error) => error === failure);
});

test('selected startup owners contain no static archive implementation imports', () => {
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/scape-inspection-service.ts',
		'src/soundscaper/editor-scape-native-v30.ts',
		'src/framescaper/editor-scape-native-v31.ts',
	]) {
		const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
		assert.doesNotMatch(source, /from ['"](?:\.\.\/)*(?:common\/editor\/)?(?:aup4-client|aup-legacy(?:-conversion)?|scape-project|scape-archive-copy)(?:\.[^'"]+)?['"]/u, path);
	}
	const legacyFramescaperExporter = readFileSync(new URL(
		'../src/framescaper/scape-project-file-export-v18.ts', import.meta.url,
	), 'utf8');
	assert.doesNotMatch(
		legacyFramescaperExporter,
		/import\s+(?!type\b)[^;]+from ['"]@zip\.js\/zip\.js['"]/u,
	);
	assert.doesNotMatch(
		legacyFramescaperExporter,
		/import\s+(?!type\b)[^;]+from ['"]\.\.\/common\/editor\/scape-export-destination\.ts['"]/u,
	);
	const projectInput = readFileSync(new URL(
		'../src/common/editor/scape-project-input.ts', import.meta.url,
	), 'utf8');
	assert.doesNotMatch(
		projectInput,
		/import\s+(?!type\b)[^;]+from ['"]\.\/scape-archive-reader\.ts['"]/u,
	);
	const manifestAction = readFileSync(new URL(
		'../src/common/editor/controller/scape-archive-manifest-action.ts', import.meta.url,
	), 'utf8');
	assert.doesNotMatch(
		manifestAction,
		/import\s+(?!type\b)[^;]+from ['"]\.\.\/scape-archive-manifest\.ts['"]/u,
	);
});
