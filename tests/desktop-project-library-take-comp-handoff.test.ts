/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import { collectProjectSourceIds } from '../src/common/editor/retention.js';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	canonicalPcmBytes,
	createHeadlessEngine,
	digest,
	owner,
	projectActions,
	projectStore,
	readPcm,
	serviceBridge,
	trackResources,
	writePcm,
} from './helpers/desktop-project-library-fallback-handoff-fixture.ts';
import {
	createCycleProducedTakeFixture,
} from './helpers/cycle-produced-take-fixture.ts';

const INITIAL_SOUND_OWNER = owner('soundscaper', 811, 'take-handoff-sound-initial');
const FRAME_OWNER = owner('framescaper', 812, 'take-handoff-frame');
const RETURN_SOUND_OWNER = owner('soundscaper', 813, 'take-handoff-sound-return');

test('take-only PCM survives a fresh read-only Framescaper handoff and returns to Soundscaper', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-take-comp-handoff-'));
	const resources = trackResources(context, appDataPath);
	const fixture = await createCycleProducedTakeFixture('finalize');
	context.after(async () => { await fixture.store.close(); });
	const projectId = fixture.project.id;
	assert.deepEqual(fixture.project.clips, []);
	assert.deepEqual(fixture.project.projectBin.clips, []);
	assert.deepEqual(
		[...collectProjectSourceIds(fixture.project)],
		fixture.pcm.map(({ source }) => source.id),
	);

	const initialHost = await resources.startHost(INITIAL_SOUND_OWNER);
	const initialService = resources.trackService(new DesktopSharedProjectLibraryService(initialHost, {
		now: () => 100_000,
		createEntryId: () => 'take-handoff-entry-0001',
	}));
	const initialStore = resources.trackStore(projectStore(
		`take-handoff-sound-initial-${String(Date.now())}-${String(Math.random())}`,
		serviceBridge(initialService).bridge,
	));
	await persistTakePcm(initialStore, fixture);
	await initialStore.saveProject(fixture.project);
	await initialStore.saveSetting('soundscaper:last-project-id', projectId);
	assert.deepEqual(initialHost.readCatalog().media, [], 'ordinary saves remain document-only');
	const initialEngine = createHeadlessEngine();
	const initialSoundscaper = resources.trackController(createEditorController(null, {
		engine: initialEngine.engine,
		headless: true,
		productId: 'soundscaper',
		store: initialStore,
	}));
	const initialReady = await initialSoundscaper.ready;
	assert.equal(initialReady.phase, 'ready', JSON.stringify(initialReady.status));
	assert.equal(initialReady.readOnly, false);
	assertExactTakeProject(initialReady.project, fixture.project);
	await assertStoredTakePcm(initialStore, fixture);
	assert.deepEqual(initialSoundscaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(await projectActions(initialSoundscaper).prepareHandoff(), {
		projectId,
		revision: fixture.project.revision,
	});
	const outbound = await initialService.readSharedProjectBundle(projectId);
	assert.ok(outbound);
	await assertManagedTakeBundle(initialService, outbound, fixture);
	await resources.disposeController(initialSoundscaper);
	await resources.closeStore(initialStore);
	await resources.disposeService(initialService);
	await resources.closeHost(initialHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	const frameService = resources.trackService(new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 110_000,
		createEntryId: () => { throw new Error('Framescaper must preserve the shared entry'); },
	}));
	const frameProbe = serviceBridge(frameService);
	const frameStore = resources.trackStore(projectStore(
		`take-handoff-frame-${String(Date.now())}-${String(Math.random())}`,
		frameProbe.bridge,
	));
	for (const { source } of fixture.pcm) assert.equal(await frameStore.getSourceMetadata(source.storageKey), null);
	assert.deepEqual(await frameStore.listProjectRevisions(projectId), []);
	await frameStore.saveSetting('framescaper:last-project-id', projectId);
	const frameEngine = createHeadlessEngine();
	const framescaper = resources.trackController(createEditorController(null, {
		engine: frameEngine.engine,
		headless: true,
		productId: 'framescaper',
		store: frameStore,
	}));
	const frameReady = await framescaper.ready;
	assert.equal(frameReady.phase, 'ready', JSON.stringify(frameReady.status));
	assert.equal(frameReady.readOnly, true, 'Framescaper must preserve unsupported take comps read-only');
	assertExactTakeProject(frameReady.project, fixture.project);
	await assertStoredTakePcm(frameStore, fixture);
	assert.deepEqual(framescaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(
		new Set(frameProbe.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(outbound.sources.map(({ bindingId }) => bindingId)),
	);
	assertExactTakeProject(
		await frameStore.loadProject(projectId, { revision: fixture.project.revision }),
		fixture.project,
	);
	assert.deepEqual(await projectActions(framescaper).prepareHandoff(), {
		projectId,
		revision: fixture.project.revision,
	});
	const returning = await frameService.readSharedProjectBundle(projectId);
	assert.ok(returning);
	await assertManagedTakeBundle(frameService, returning, fixture);
	assert.equal(returning.document, outbound.document, 'read-only handoff must preserve the exact document');
	await resources.disposeController(framescaper);
	await resources.closeStore(frameStore);
	await resources.disposeService(frameService);
	await resources.closeHost(frameHost);

	const returnHost = await resources.startHost(RETURN_SOUND_OWNER);
	const returnService = resources.trackService(new DesktopSharedProjectLibraryService(returnHost, {
		now: () => 120_000,
		createEntryId: () => { throw new Error('return must preserve the shared entry'); },
	}));
	const returnProbe = serviceBridge(returnService);
	const returnStore = resources.trackStore(projectStore(
		`take-handoff-sound-return-${String(Date.now())}-${String(Math.random())}`,
		returnProbe.bridge,
	));
	for (const { source } of fixture.pcm) assert.equal(await returnStore.getSourceMetadata(source.storageKey), null);
	assert.deepEqual(await returnStore.listProjectRevisions(projectId), []);
	await returnStore.saveSetting('soundscaper:last-project-id', projectId);
	const returnEngine = createHeadlessEngine();
	const returnedSoundscaper = resources.trackController(createEditorController(null, {
		engine: returnEngine.engine,
		headless: true,
		productId: 'soundscaper',
		store: returnStore,
	}));
	const returnReady = await returnedSoundscaper.ready;
	assert.equal(returnReady.phase, 'ready', JSON.stringify(returnReady.status));
	assert.equal(returnReady.readOnly, false);
	assertExactTakeProject(returnReady.project, fixture.project);
	await assertStoredTakePcm(returnStore, fixture);
	assert.deepEqual(returnedSoundscaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(
		new Set(returnProbe.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(returning.sources.map(({ bindingId }) => bindingId)),
	);
	assertExactTakeProject(
		await returnStore.loadProject(projectId, { revision: fixture.project.revision }),
		fixture.project,
	);
});

type TakeFixture = Awaited<ReturnType<typeof createCycleProducedTakeFixture>>;

async function persistTakePcm(store: AudioEditorProjectStore, fixture: TakeFixture): Promise<void> {
	for (const { channels, source } of fixture.pcm) await writePcm(store, source, channels);
}

async function assertStoredTakePcm(store: AudioEditorProjectStore, fixture: TakeFixture): Promise<void> {
	for (const { channels, source } of fixture.pcm) {
		assert.deepEqual(await readPcm(store, source.storageKey), channels);
	}
}

function assertExactTakeProject(value: unknown, expected: AudioEditorProjectCurrent): void {
	assert.ok(value);
	const project = typeof value === 'string' ? parseScapeProjectDocument(value) : value;
	assert.equal(serializeScapeProjectDocument(project), serializeScapeProjectDocument(expected));
	assert.deepEqual((project as AudioEditorProjectCurrent).takeGroups, expected.takeGroups);
}

async function assertManagedTakeBundle(
	service: DesktopSharedProjectLibraryService,
	bundle: NonNullable<Awaited<ReturnType<DesktopSharedProjectLibraryService['readSharedProjectBundle']>>>,
	fixture: TakeFixture,
): Promise<void> {
	assertExactTakeProject(bundle.document, fixture.project);
	assert.deepEqual(bundle.sources.map(({ byteLength, encoding, kind, sha256, sourceId, storageKey }) => ({
		byteLength, encoding, kind, sha256, sourceId, storageKey,
	})), fixture.pcm.map(({ channels, source }) => {
		const bytes = canonicalPcmBytes(channels);
		return {
			byteLength: bytes.byteLength,
			encoding: 'audio-f32le-chunks-v1',
			kind: 'audio',
			sha256: digest(bytes),
			sourceId: source.id,
			storageKey: source.storageKey,
		};
	}));
	for (const [index, descriptor] of bundle.sources.entries()) {
		const expected = fixture.pcm[index];
		assert.ok(expected);
		assert.deepEqual(
			await service.readSharedSourceChunk(descriptor.bindingId, {
				offset: 0,
				length: descriptor.byteLength,
			}),
			canonicalPcmBytes(expected.channels),
		);
	}
}
