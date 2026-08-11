/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import {
	createDesktopProjectLibraryPaths,
	type DesktopLibraryOwner,
} from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import {
	parseScapeProjectDocument,
	SCAPE_PROJECT_BINARY_HARD_LIMITS,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';

const OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'editor-library-soundscaper',
});
const OTHER_OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'editor-library-framescaper',
});
const NOW = '2026-07-29T12:00:00.000Z';

test('editor service enforces expected-base CAS while preserving identical retries', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	const service = new DesktopSharedProjectLibraryService(host, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-cas01',
	});

	const initial = currentDocument(1);
	assert.deepEqual(await service.commitSharedProject({ document: initial, expectedRevision: null }), {
		status: 'committed',
		document: initial,
	});
	assert.deepEqual(await service.commitSharedProject({ document: initial, expectedRevision: null }), {
		status: 'committed',
		document: initial,
	});
	const jumped = currentDocument(5);
	assert.deepEqual(await service.commitSharedProject({ document: jumped, expectedRevision: 1 }), {
		status: 'committed',
		document: jumped,
	});
	const beforeConflict = host.readCatalog();
	assert.deepEqual(await service.commitSharedProject({ document: currentDocument(6), expectedRevision: 1 }), {
		status: 'conflict',
		currentRevision: 5,
	});
	assert.deepEqual(host.readCatalog(), beforeConflict);
	assert.equal(await service.readSharedProject('editor-project-1'), jumped);
});

test('editor service exposes canonical CRUD by project identity and retains deleted immutable files', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	let generatedIds = 0;
	const clock = { value: 10_000 };
	const service = new DesktopSharedProjectLibraryService(host, {
		now: () => clock.value,
		createEntryId: () => {
			generatedIds += 1;
			return 'opaque-entry-0001';
		},
	});
	const canonical = currentDocument(1);

	assert.deepEqual(service.listSharedProjects(), []);
	assert.equal(await commitDocument(service, `\n${canonical}\n`), canonical);
	const catalogAfterCommit = host.readCatalog();
	assert.equal(generatedIds, 1);
	assert.equal(catalogAfterCommit.revision, 1);
	assert.deepEqual(catalogAfterCommit.projects.map(({ id, preferredProduct }) => ({ id, preferredProduct })), [{
		id: 'opaque-entry-0001',
		preferredProduct: 'soundscaper',
	}]);
	assert.deepEqual(service.listSharedProjects(), [{
		id: 'editor-project-1',
		title: 'Editor project',
		revision: 1,
		updatedAt: '1970-01-01T00:00:10.000Z',
	}]);
	assert.equal(await service.readSharedProject('editor-project-1'), canonical);

	clock.value = 20_000;
	assert.equal(await commitDocument(service, canonical, 1), canonical);
	assert.deepEqual(host.readCatalog(), catalogAfterCommit);
	assert.equal(generatedIds, 1);

	const immutableFile = join(fixture.paths.projectsRoot, catalogAfterCommit.projects[0]!.metadataFile);
	assert.equal(await service.deleteSharedProject('editor-project-1'), true);
	assert.equal(host.readCatalog().revision, 2);
	assert.deepEqual(service.listSharedProjects(), []);
	assert.equal(await service.readSharedProject('editor-project-1'), null);
	assert.equal((await stat(immutableFile)).isFile(), true);
	assert.equal(await service.deleteSharedProject('editor-project-1'), false);
	assert.equal(host.readCatalog().revision, 2);
});

test('editor service rejects generated entry ids that cannot form portable project paths', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());

	for (const entryId of ['_opaque-entry-01', '-opaque-entry-01']) {
		const service = new DesktopSharedProjectLibraryService(host, {
			now: () => 10_000,
			createEntryId: () => entryId,
		});
		await assert.rejects(() => commitDocument(service, currentDocument(1)), /entry id generator/iu);
	}
	assert.deepEqual(host.readCatalog().projects, []);
});

test('editor service requires a bounded exact-current root envelope without publishing rejected input', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	let commitCalls = 0;
	const service = new DesktopSharedProjectLibraryService({
		commitProjectById: (options) => { commitCalls += 1; return host.commitProjectById(options); },
		deleteProjectById: (options) => host.deleteProjectById(options),
		publishManagedMedia: (options) => host.publishManagedMedia(options),
		readCatalog: () => host.readCatalog(),
		readManagedMedia: (bindingId, options) => host.readManagedMedia(bindingId, options),
		readProjectById: (projectId, signal) => host.readProjectById(projectId, signal),
		readProjectBundleById: (projectId, signal) => host.readProjectBundleById(projectId, signal),
		snapshot: () => host.snapshot(),
	}, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0002',
	});
	const current = parseScapeProjectDocument(currentDocument(1)) as Record<string, unknown>;
	const source = createAudioSourceV9({
		id: 'domain-source-1',
		name: 'Domain source',
		storageKey: 'domain-source-storage-1',
		frameCount: 48_000,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const withSource = createCurrentAudioEditorProject({
		id: 'domain-project-1',
		title: 'Domain project',
		revision: 1,
		now: NOW,
		sources: [source],
	});
	const clip = createAudioClipV9({
		id: 'domain-clip-1',
		sourceId: source.id,
		durationFrames: 48_000,
	});
	const track = createAudioTrackV9({ id: 'domain-track-1', clipIds: [clip.id] });
	const withGraph = createCurrentAudioEditorProject({
		id: 'domain-graph-project-1',
		title: 'Domain graph project',
		revision: 1,
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});
	for (const candidate of [
		{ ...current, schemaVersion: 15 },
		{ ...current, schemaVersion: 17 },
		{ ...current, id: '' },
		{ ...current, id: 'x'.repeat(4 * 1024 + 1) },
		{ ...current, title: 'x'.repeat(256) },
		{ ...current, title: ' Editor project' },
		{ ...current, title: 'Editor\u0000project' },
		{ ...current, revision: -1 },
		{ ...current, sources: {} },
		{ ...current, projectBin: { clips: {} } },
		{ ...current, featureRequirements: { schemaVersion: 1, requirements: {} } },
		{ ...withSource, sources: [source, source] },
		{ ...withGraph, clips: [{ ...clip, sourceId: 'missing-source' }] },
		{ ...withGraph, tracks: [{ ...track, clipIds: ['missing-clip'] }] },
	]) {
		await assert.rejects(
			() => commitDocument(service, serializeScapeProjectDocument(candidate)),
			/schema|non-empty|byte limit|title|revision|array|duplicate|missing/u,
		);
	}
	assert.equal(commitCalls, 0);
	assert.equal(host.readCatalog().revision, 0);
	assert.deepEqual(await readdir(fixture.paths.projectsRoot), []);
});

test('editor service rejects a domain-invalid host commit result before returning it', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	let commitCalls = 0;
	const service = new DesktopSharedProjectLibraryService({
		commitProjectById: async (options) => {
			commitCalls += 1;
			const loaded = await host.commitProjectById(options);
			return { ...loaded, project: { ...loaded.project, sources: {} } };
		},
		deleteProjectById: (options) => host.deleteProjectById(options),
		publishManagedMedia: (options) => host.publishManagedMedia(options),
		readCatalog: () => host.readCatalog(),
		readManagedMedia: (bindingId, options) => host.readManagedMedia(bindingId, options),
		readProjectById: (projectId, signal) => host.readProjectById(projectId, signal),
		readProjectBundleById: (projectId, signal) => host.readProjectBundleById(projectId, signal),
		snapshot: () => host.snapshot(),
	}, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0008',
	});

	await assert.rejects(
		() => commitDocument(service, currentDocument(1)),
		/sources.*array/iu,
	);
	assert.equal(commitCalls, 1);
	assert.equal(host.readCatalog().revision, 1);
});

test('editor service rejects a domain-invalid stored project before returning it', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	const project = parseScapeProjectDocument(currentDocument(1)) as Record<string, unknown>;
	await host.commitProjectById({
		createEntryId: () => 'opaque-entry-0007',
		name: 'Editor project',
		preferredProduct: 'soundscaper',
		project: { ...project, sources: {} },
		updatedAtMs: 10_000,
	});
	const reader = new DesktopSharedProjectLibraryService(host);

	await assert.rejects(
		() => reader.readSharedProject('editor-project-1'),
		/sources.*array/iu,
	);
});

test('editor service applies lower-only structural budgets before host mutation and responses', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	const baseDocument = currentDocument(1);
	const baseProject = parseScapeProjectDocument(baseDocument) as Record<string, unknown>;
	const wideProject = {
		...baseProject,
		opaqueExtensions: { items: Array.from({ length: 16 }, (_, index) => index) },
	};
	let deepExtension: Record<string, unknown> = {};
	for (let depth = 0; depth < 6; depth += 1) deepExtension = { nested: deepExtension };
	const deepProject = { ...baseProject, opaqueExtensions: deepExtension };
	let commitCalls = 0;
	const boundedHost = {
		commitProjectById: async (options: Parameters<typeof host.commitProjectById>[0]) => {
			commitCalls += 1;
			const loaded = await host.commitProjectById(options);
			return { ...loaded, project: wideProject };
		},
		deleteProjectById: (options: Parameters<typeof host.deleteProjectById>[0]) => host.deleteProjectById(options),
		publishManagedMedia: (options: Parameters<typeof host.publishManagedMedia>[0]) => host.publishManagedMedia(options),
		readCatalog: () => host.readCatalog(),
		readManagedMedia: (...args: Parameters<typeof host.readManagedMedia>) => host.readManagedMedia(...args),
		readProjectById: async (projectId: string, signal?: AbortSignal) => {
			const loaded = await host.readProjectById(projectId, signal);
			return loaded ? { ...loaded, project: deepProject } : null;
		},
		readProjectBundleById: (projectId: string, signal?: AbortSignal) => host.readProjectBundleById(projectId, signal),
		snapshot: () => host.snapshot(),
	};
	const service = new DesktopSharedProjectLibraryService(boundedHost, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0009',
		documentLimits: {
			maximumPayloadCount: 1,
			maximumTraversalNodes: 120,
			maximumTraversalDepth: 5,
		},
	});

	await assert.rejects(
		() => commitDocument(service, serializeScapeProjectDocument(wideProject)),
		/structural traversal node limit|binary traversal node limit/iu,
	);
	assert.equal(commitCalls, 0, 'over-budget renderer input must not reach the host');
	assert.equal(host.readCatalog().revision, 0);
	assert.deepEqual(await readdir(fixture.paths.projectsRoot), []);
	await assert.rejects(
		() => commitDocument(service, baseDocument),
		/validation.*structural traversal node limit/iu,
	);
	assert.equal(commitCalls, 1, 'a bounded input may commit before an over-budget host result is rejected');
	assert.equal(host.readCatalog().revision, 1);
	await assert.rejects(
		() => service.readSharedProject('editor-project-1'),
		/validation.*structural traversal depth limit/iu,
	);

	assert.throws(
		() => new DesktopSharedProjectLibraryService(host, {
			documentLimits: {
				maximumTraversalNodes: SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalNodes + 1,
			},
		}),
		/cannot exceed.*hard limit/iu,
	);
	assert.throws(
		() => new DesktopSharedProjectLibraryService(host, {
			documentLimits: {
				maximumTraversalDepth: SCAPE_PROJECT_BINARY_HARD_LIMITS.maximumTraversalDepth + 1,
			},
		}),
		/cannot exceed.*hard limit/iu,
	);
});

test('editor service rejects loaded accessors without activating them', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	const baseProject = parseScapeProjectDocument(currentDocument(1)) as Record<string, unknown>;
	let activations = 0;
	const accessorProject = () => {
		const project = { ...baseProject };
		Object.defineProperty(project, 'title', {
			enumerable: true,
			get() {
				activations += 1;
				return 'Accessor project';
			},
		});
		return project;
	};
	const guardedHost = {
		commitProjectById: async (options: Parameters<typeof host.commitProjectById>[0]) => {
			const loaded = await host.commitProjectById(options);
			return { ...loaded, project: accessorProject() };
		},
		deleteProjectById: (options: Parameters<typeof host.deleteProjectById>[0]) => host.deleteProjectById(options),
		publishManagedMedia: (options: Parameters<typeof host.publishManagedMedia>[0]) => host.publishManagedMedia(options),
		readCatalog: () => host.readCatalog(),
		readManagedMedia: (...args: Parameters<typeof host.readManagedMedia>) => host.readManagedMedia(...args),
		readProjectById: async (projectId: string, signal?: AbortSignal) => {
			const loaded = await host.readProjectById(projectId, signal);
			return loaded ? { ...loaded, project: accessorProject() } : null;
		},
		readProjectBundleById: (projectId: string, signal?: AbortSignal) => host.readProjectBundleById(projectId, signal),
		snapshot: () => host.snapshot(),
	};
	const service = new DesktopSharedProjectLibraryService(guardedHost, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0010',
	});

	await assert.rejects(() => commitDocument(service, currentDocument(1)), /enumerable.*data propert/iu);
	assert.equal(host.readCatalog().revision, 1, 'loaded-result refusal happens after the admitted host commit');
	assert.equal(activations, 0);
	await assert.rejects(() => service.readSharedProject('editor-project-1'), /enumerable.*data propert/iu);
	assert.equal(activations, 0);
});

test('canonical source references remain metadata-only and do not claim managed media', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	const service = new DesktopSharedProjectLibraryService(host, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0003',
	});
	const source = createAudioSourceV9({
		id: 'retained-source-1',
		name: 'Retained source',
		storageKey: 'indexeddb-source-1',
		frameCount: 48_000,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const document = serializeScapeProjectDocument(createCurrentAudioEditorProject({
		id: 'source-metadata-project',
		title: 'Source metadata project',
		revision: 1,
		now: NOW,
		sources: [source],
	}));

	assert.equal(await commitDocument(service, document), document);
	assert.equal(await service.readSharedProject('source-metadata-project'), document);
	assert.deepEqual(host.readCatalog().media, []);
	assert.deepEqual(await readdir(fixture.paths.managedMediaRoot), []);
});

test('identical cross-product retries preserve catalog metadata and divergent revisions fail closed', async (context) => {
	const fixture = await createFixture(context);
	const soundscaper = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => soundscaper.close());
	const firstService = new DesktopSharedProjectLibraryService(soundscaper, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0006',
	});
	const canonical = currentDocument(1);
	await commitDocument(firstService, canonical);
	const originalCatalog = soundscaper.readCatalog();
	await soundscaper.close();

	const framescaper = await startHost(fixture.appDataRoot, OTHER_OWNER);
	context.after(() => framescaper.close());
	const retryService = new DesktopSharedProjectLibraryService(framescaper, {
		now: () => 20_000,
		createEntryId: () => { throw new Error('an existing identity must retain its entry id'); },
	});
	assert.equal(await commitDocument(retryService, canonical), canonical);
	assert.deepEqual(framescaper.readCatalog(), originalCatalog);

	const project = parseScapeProjectDocument(canonical) as Record<string, unknown>;
	const divergent = serializeScapeProjectDocument({ ...project, title: 'Divergent title' });
	assert.deepEqual(await retryService.commitSharedProject({ document: divergent, expectedRevision: 1 }), {
		status: 'conflict', currentRevision: 1,
	});
	assert.deepEqual(framescaper.readCatalog(), originalCatalog);
});

test('host serializes editor commits and catalog-only deletes under the same mutation tail', async (context) => {
	const fixture = await createFixture(context);
	const host = await startHost(fixture.appDataRoot, OWNER);
	context.after(() => host.close());
	const service = new DesktopSharedProjectLibraryService(host, {
		now: () => 10_000,
		createEntryId: () => 'opaque-entry-0004',
	});

	const commit = commitDocument(service, currentDocument(1));
	const deletion = service.deleteSharedProject('editor-project-1');
	assert.equal(await commit, currentDocument(1));
	assert.equal(await deletion, true);
	assert.equal(host.readCatalog().revision, 2);
	assert.deepEqual(host.readCatalog().projects, []);
});

test('catalog-only delete is fenced from stale leases and never removes immutable documents', async (context) => {
	const fixture = await createFixture(context);
	const clock = { value: 10_000 };
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: () => clock.value });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: () => clock.value });
	context.after(() => {
		first.close();
		second.close();
	});
	const firstStore = new DesktopLibraryProjectStore(first);
	const secondStore = new DesktopLibraryProjectStore(second);
	const original = await first.acquireLease({ owner: OWNER, ttlMs: 1_000 });
	const committed = await firstStore.commitProjectById({
		lease: original,
		createEntryId: () => 'opaque-entry-0005',
		name: 'Editor project',
		project: parseScapeProjectDocument(currentDocument(1)),
		preferredProduct: 'soundscaper',
		updatedAtMs: 10_000,
	});
	const immutableFile = join(fixture.paths.projectsRoot, committed.catalog.metadataFile);
	clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OTHER_OWNER, ttlMs: 1_000 });

	await assert.rejects(
		() => firstStore.deleteProjectById({ lease: original, projectId: 'editor-project-1' }),
		/no longer owns the lease/u,
	);
	assert.equal(second.readMetadata().revision, 1);
	assert.equal((await stat(immutableFile)).isFile(), true);
	assert.equal(await secondStore.deleteProjectById({
		lease: replacement,
		projectId: 'editor-project-1',
	}), true);
	assert.equal(second.readMetadata().revision, 2);
	assert.equal((await stat(immutableFile)).isFile(), true);
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-editor-service-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	return {
		appDataRoot,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

function startHost(appDataPath: string, owner: DesktopLibraryOwner) {
	return DesktopProjectLibraryHost.start({
		appDataPath,
		owner,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
}

function currentDocument(revision: number): string {
	return serializeScapeProjectDocument(createCurrentAudioEditorProject({
		id: 'editor-project-1',
		title: 'Editor project',
		revision,
		now: NOW,
	}));
}

async function commitDocument(
	service: DesktopSharedProjectLibraryService,
	document: string,
	expectedRevision: number | null = null,
): Promise<string> {
	const result = await service.commitSharedProject({ document, expectedRevision });
	if (result.status === 'conflict') throw new Error(`unexpected conflict at revision ${result.currentRevision}`);
	return result.document;
}
