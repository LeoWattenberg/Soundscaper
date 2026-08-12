/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
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
	createAudioWarpProjectFixture,
	WARP_MAP,
	WARP_PROJECT_ID,
} from './helpers/audio-warp-cross-product-fixture.ts';

const INITIAL_SOUND_OWNER = owner('soundscaper', 821, 'warp-handoff-sound-initial');
const FRAME_OWNER = owner('framescaper', 822, 'warp-handoff-frame');
const RETURN_SOUND_OWNER = owner('soundscaper', 823, 'warp-handoff-sound-return');

test('native warped PCM survives a fresh read-only Framescaper desktop handoff and returns editable', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-audio-warp-handoff-'));
	const resources = trackResources(context, appDataPath);
	const fixture = createAudioWarpProjectFixture();

	const initialHost = await resources.startHost(INITIAL_SOUND_OWNER);
	const initialService = resources.trackService(new DesktopSharedProjectLibraryService(initialHost, {
		now: () => 100_000,
		createEntryId: () => 'warp-handoff-entry-0001',
	}));
	const initialStore = resources.trackStore(projectStore(
		`warp-handoff-sound-initial-${String(Date.now())}-${String(Math.random())}`,
		serviceBridge(initialService).bridge,
	));
	await writePcm(initialStore, fixture.source, fixture.channels);
	await initialStore.saveProject(fixture.project);
	await initialStore.saveSetting('soundscaper:last-project-id', WARP_PROJECT_ID);
	const initialController = resources.trackController(createEditorController(null, {
		engine: createHeadlessEngine().engine,
		headless: true,
		productId: 'soundscaper',
		store: initialStore,
	}));
	const initialReady = await initialController.ready;
	assert.equal(initialReady.phase, 'ready', JSON.stringify(initialReady.status));
	assert.equal(initialReady.readOnly, false);
	assertExactWarpProject(initialReady.project, fixture.project);
	assert.deepEqual(initialController.getSnapshot().missingSourceIds, []);
	assert.deepEqual(await projectActions(initialController).prepareHandoff(), {
		projectId: WARP_PROJECT_ID,
		revision: fixture.project.revision,
	});
	const outbound = await initialService.readSharedProjectBundle(WARP_PROJECT_ID);
	assert.ok(outbound);
	await assertManagedWarpBundle(initialService, outbound, fixture);
	await resources.disposeController(initialController);
	await resources.closeStore(initialStore);
	await resources.disposeService(initialService);
	await resources.closeHost(initialHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	const frameService = resources.trackService(new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 110_000,
		createEntryId: () => { throw new Error('Framescaper must preserve the shared entry'); },
	}));
	const frameBridge = serviceBridge(frameService);
	const frameStore = resources.trackStore(projectStore(
		`warp-handoff-frame-${String(Date.now())}-${String(Math.random())}`,
		frameBridge.bridge,
	));
	await frameStore.saveSetting('framescaper:last-project-id', WARP_PROJECT_ID);
	const framescaper = resources.trackController(createEditorController(null, {
		engine: createHeadlessEngine().engine,
		headless: true,
		productId: 'framescaper',
		store: frameStore,
	}));
	const frameReady = await framescaper.ready;
	assert.equal(frameReady.phase, 'ready', JSON.stringify(frameReady.status));
	assert.equal(frameReady.readOnly, true);
	assertExactWarpProject(frameReady.project, fixture.project);
	assert.deepEqual(await readPcm(frameStore, fixture.source.storageKey), fixture.channels);
	assert.deepEqual(framescaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(new Set(frameBridge.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(outbound.sources.map(({ bindingId }) => bindingId)));
	assert.deepEqual(await projectActions(framescaper).prepareHandoff(), {
		projectId: WARP_PROJECT_ID,
		revision: fixture.project.revision,
	});
	const returning = await frameService.readSharedProjectBundle(WARP_PROJECT_ID);
	assert.ok(returning);
	await assertManagedWarpBundle(frameService, returning, fixture);
	assert.equal(returning.document, outbound.document);
	await resources.disposeController(framescaper);
	await resources.closeStore(frameStore);
	await resources.disposeService(frameService);
	await resources.closeHost(frameHost);

	const returnHost = await resources.startHost(RETURN_SOUND_OWNER);
	const returnService = resources.trackService(new DesktopSharedProjectLibraryService(returnHost, {
		now: () => 120_000,
		createEntryId: () => { throw new Error('Soundscaper return must preserve the shared entry'); },
	}));
	const returnBridge = serviceBridge(returnService);
	const returnStore = resources.trackStore(projectStore(
		`warp-handoff-sound-return-${String(Date.now())}-${String(Math.random())}`,
		returnBridge.bridge,
	));
	await returnStore.saveSetting('soundscaper:last-project-id', WARP_PROJECT_ID);
	const returnedSoundscaper = resources.trackController(createEditorController(null, {
		engine: createHeadlessEngine().engine,
		headless: true,
		productId: 'soundscaper',
		store: returnStore,
	}));
	const returnReady = await returnedSoundscaper.ready;
	assert.equal(returnReady.phase, 'ready', JSON.stringify(returnReady.status));
	assert.equal(returnReady.readOnly, false);
	assertExactWarpProject(returnReady.project, fixture.project);
	assert.deepEqual(await readPcm(returnStore, fixture.source.storageKey), fixture.channels);
	assert.deepEqual(returnedSoundscaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(new Set(returnBridge.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(returning.sources.map(({ bindingId }) => bindingId)));
});

type WarpFixture = ReturnType<typeof createAudioWarpProjectFixture>;

function assertExactWarpProject(value: unknown, expected: AudioEditorProjectCurrent): void {
	assert.ok(value);
	assert.equal(serializeScapeProjectDocument(value as AudioEditorProjectCurrent),
		serializeScapeProjectDocument(expected));
	const clip = (value as AudioEditorProjectCurrent).clips[0];
	assert.ok(clip?.kind === 'audio');
	assert.deepEqual(clip.warpMap, WARP_MAP);
}

async function assertManagedWarpBundle(
	service: DesktopSharedProjectLibraryService,
	bundle: NonNullable<Awaited<ReturnType<DesktopSharedProjectLibraryService['readSharedProjectBundle']>>>,
	fixture: WarpFixture,
): Promise<void> {
	assert.equal(bundle.document, serializeScapeProjectDocument(fixture.project));
	const bytes = canonicalPcmBytes(fixture.channels);
	assert.deepEqual(bundle.sources.map(({ byteLength, encoding, kind, sha256, sourceId, storageKey }) => ({
		byteLength, encoding, kind, sha256, sourceId, storageKey,
	})), [{
		byteLength: bytes.byteLength,
		encoding: 'audio-f32le-chunks-v1',
		kind: 'audio',
		sha256: digest(bytes),
		sourceId: fixture.source.id,
		storageKey: fixture.source.storageKey,
	}]);
	const descriptor = bundle.sources[0];
	assert.ok(descriptor);
	assert.deepEqual(await service.readSharedSourceChunk(descriptor.bindingId, {
		offset: 0,
		length: descriptor.byteLength,
	}), bytes);
}
