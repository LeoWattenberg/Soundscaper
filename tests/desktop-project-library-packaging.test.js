/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	DESKTOP_EXPECTED_RUNTIME_FILES,
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop runtime compilation emits importable JavaScript with rewritten extensions', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	// The compile fails closed on its own manifest, so a second hand-maintained
	// copy of the same 450-line list here carried no independent signal — both
	// copies are written by the same change — and a slice that added five
	// runtime members left this one behind and broke the quality gate. Pin the
	// reported set to the shipped manifest and keep the checks below, which say
	// something the manifest cannot: that the output actually imports.
	assert.deepEqual(result.files, [...DESKTOP_EXPECTED_RUNTIME_FILES]);
	for (const name of result.files) {
		const source = await readFile(join(outputRoot, name), 'utf8');
		assert.doesNotMatch(source, /from ['"].*\.ts['"]/u);
	}
	const packagedRuntimePrefix = './desktop/project-library-runtime/';
	for (const [specifier, target] of Object.entries(DESKTOP_RUNTIME_PACKAGE_IMPORTS)) {
		assert.ok(target.startsWith(packagedRuntimePrefix),
			`${specifier} must resolve inside the packaged desktop runtime`);
		assert.ok(result.files.includes(target.slice(packagedRuntimePrefix.length)),
			`${specifier} must resolve to a compiled desktop runtime member`);
	}
	assert.ok(result.files.includes('src/common/editor/project-hierarchy-document-validation.js'));
	assert.ok(result.files.includes('src/common/editor/track-folder-v12.js'));
	assert.ok(result.files.includes('src/common/editor/track-hierarchy-v12.js'));
	assert.ok(result.files.includes('src/common/editor/timeline-annotation.js'));
	assert.equal(result.files.includes('src/common/editor/project-current.js'), false);
	assert.equal(result.files.includes('src/common/editor/pffft.js'), true);
	const runtime = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-host.js')).href}?test=${Date.now()}`);
	const linkedVideoRegistry = await import(`${pathToFileURL(join(outputRoot, 'desktop/linked-video-locator-registry.js')).href}?test=${Date.now()}`);
	const linkedVideoStore = await import(`${pathToFileURL(join(outputRoot, 'desktop/linked-video-locator-store.js')).href}?test=${Date.now()}`);
	const editorService = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-editor-service.js')).href}?test=${Date.now()}`);
	const editorMediaService = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-editor-media-service.js')).href}?test=${Date.now()}`);
	const managedMedia = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-media.js')).href}?test=${Date.now()}`);
	for (const generation of [13, 14, 15, 16]) {
		const candidateMain = await import(`${pathToFileURL(join(outputRoot, `desktop/project-library-v${String(generation)}-main.js`)).href}?test=${Date.now()}`);
		const candidateIpc = await import(`${pathToFileURL(join(outputRoot, `desktop/project-library-v${String(generation)}-main-ipc.js`)).href}?test=${Date.now()}`);
		assert.equal(typeof candidateMain[`FramescaperDesktopProjectLibraryV${String(generation)}Main`], 'function');
		assert.equal(typeof candidateIpc[`registerFramescaperDesktopProjectLibraryV${String(generation)}MainIpc`], 'function');
	}
	assert.equal(typeof runtime.DesktopProjectLibraryHost?.start, 'function');
	assert.equal(typeof linkedVideoRegistry.FileDesktopLinkedVideoLocatorRegistry, 'function');
	assert.equal(typeof linkedVideoStore.DesktopLinkedVideoLocatorStore, 'function');
	assert.equal(typeof editorService.DesktopSharedProjectLibraryService, 'function');
	assert.equal(typeof editorMediaService.DesktopSharedProjectMediaService, 'function');
	assert.equal(typeof managedMedia.DesktopLibraryManagedMediaStore, 'function');
	let commitCalls = 0;
	const unusedManagedMediaHost = {
		publishManagedMedia: async () => { throw new Error('Unexpected managed-media publication'); },
		readManagedMedia: async () => new Uint8Array(),
		readProjectBundleById: async () => null,
	};
	const service = new editorService.DesktopSharedProjectLibraryService({
		...unusedManagedMediaHost,
		commitProjectById: async ({ project }) => {
			commitCalls += 1;
			return { catalog: {}, project };
		},
		deleteProjectById: async () => false,
		readCatalog: () => ({ projects: [] }),
		readProjectById: async () => null,
		snapshot: () => ({ owner: { product: 'soundscaper' } }),
	}, {
		createEntryId: () => 'packaging-entry-0001',
		now: () => 10_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'packaging-project',
		title: 'Packaging project',
		now: '2026-07-30T12:00:00.000Z',
	});
	const validDocument = serializeScapeProjectDocument(project);
	assert.deepEqual(await service.commitSharedProject({ document: validDocument, expectedRevision: null }), {
		status: 'committed', document: validDocument,
	});
	const invalidDocument = serializeScapeProjectDocument({ ...project, tempo: { ...project.tempo, bpm: 0 } });
	await assert.rejects(() => service.commitSharedProject({
		document: invalidDocument, expectedRevision: null,
	}), /tempo\.bpm/u);
	assert.equal(commitCalls, 1);
	const boundedService = new editorService.DesktopSharedProjectLibraryService({
		...unusedManagedMediaHost,
		commitProjectById: async ({ project: committedProject }) => {
			commitCalls += 1;
			return { catalog: {}, project: committedProject };
		},
		deleteProjectById: async () => false,
		readCatalog: () => ({ projects: [] }),
		readProjectById: async () => null,
		snapshot: () => ({ owner: { product: 'soundscaper' } }),
	}, {
		createEntryId: () => 'packaging-entry-0002',
		documentLimits: {
			maximumPayloadCount: 1,
			maximumTraversalNodes: 80,
		},
		now: () => 10_000,
	});
	const overBudgetDocument = serializeScapeProjectDocument({
		...project,
		opaqueExtensions: { items: Array.from({ length: 16 }, (_, index) => index) },
	});
	await assert.rejects(
		() => boundedService.commitSharedProject({ document: overBudgetDocument, expectedRevision: null }),
		/JSON.*structural traversal node limit/iu,
	);
	assert.equal(commitCalls, 1, 'compiled structural admission must run before the host commit');
	await Promise.all([service.dispose(), boundedService.dispose()]);
});
