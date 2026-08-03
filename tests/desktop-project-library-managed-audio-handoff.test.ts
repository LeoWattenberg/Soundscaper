/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import type { DesktopLibraryOwner } from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type {
	DesktopSharedProjectBridge,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import type { EditorController } from '../src/common/editor/types.ts';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const MANAGED_PCM_BYTES = 20;
const MANAGED_PCM_SHA256 = '6f2c7d30e1887852cdf1ee60c14b93214f029d7fa0de1af6e709972e2d1693c7';
const LOCATOR_ID = 'locator_audio_managed_handoff_0001';
const LOCATOR_REVISION = 'snapshot_audio_managed_handoff_0001';
const PCM_SAMPLES = Object.freeze([0.125, -0.25, 0.5, -1]);
const SOUND_OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 401,
	instanceId: 'managed-handoff-soundscaper',
});
const FRAME_OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 402,
	instanceId: 'managed-handoff-framescaper',
});

interface ProjectActions {
	readonly prepareHandoff: () => Promise<Readonly<{ projectId: string; revision: number }>>;
}

interface LinkedPcmContainer {
	readonly label: string;
	readonly extension: '.aiff' | '.wav';
	readonly mimeType: 'audio/aiff' | 'audio/wav';
	readonly encode: (samples: readonly number[]) => Uint8Array;
}

const LINKED_PCM_CONTAINERS: readonly LinkedPcmContainer[] = Object.freeze([
	Object.freeze({
		label: 'BW64 .wav',
		extension: '.wav',
		mimeType: 'audio/wav',
		encode: int16Bw64Wav,
	}),
	Object.freeze({
		label: 'classic AIFF',
		extension: '.aiff',
		mimeType: 'audio/aiff',
		encode: int16Aiff,
	}),
	Object.freeze({
		label: 'first-party AIFF-C float32',
		extension: '.aiff',
		mimeType: 'audio/aiff',
		encode: float32Aifc,
	}),
]);

for (const container of LINKED_PCM_CONTAINERS) test(
	`explicit handoff turns linked ${container.label} into recipient-owned canonical PCM`,
	async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-managed-audio-handoff-'));
	const resources = trackResources(context, appDataPath);
	const indexedDB = createInstrumentedIndexedDB();
	const soundDatabaseName = `linked-wav-handoff-sound-${Date.now()}-${Math.random()}`;
	const frameDatabaseName = `linked-wav-handoff-frames-${Date.now()}-${Math.random()}`;
	const externalPcmBytes = container.encode(PCM_SAMPLES);
	const externalPcm = new Blob([exactArrayBuffer(externalPcmBytes)], { type: container.mimeType });
	let linkedLoads = 0;
	const linkedOriginalPort: LinkedOriginalPort = {
		load(kind, locatorId, { expectedRevision }) {
			linkedLoads += 1;
			assert.equal(kind, 'audio');
			assert.equal(locatorId, LOCATOR_ID);
			if (expectedRevision !== null && expectedRevision !== LOCATOR_REVISION) return null;
			return { blob: externalPcm, locatorRevision: LOCATOR_REVISION };
		},
	};
	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundService = new DesktopSharedProjectLibraryService(soundHost, {
		now: () => 30_000,
		createEntryId: () => 'managed-handoff-entry-0001',
	});
	const source = createAudioSourceV9({
		id: 'managed-handoff-audio-source',
		storageKey: 'managed-handoff-audio-source',
		name: `Managed handoff${container.extension}`,
		mimeType: container.mimeType,
		frameCount: PCM_SAMPLES.length,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: PCM_SAMPLES.length,
	});
	const clip = createAudioClipV9({
		id: 'managed-handoff-audio-clip',
		sourceId: source.id,
		title: 'Managed handoff clip',
		durationFrames: PCM_SAMPLES.length,
		sourceDurationFrames: PCM_SAMPLES.length,
	});
	const track = createAudioTrackV9({
		id: 'managed-handoff-audio-track',
		name: 'Managed handoff audio',
		clipIds: [clip.id],
	});
	const project = exactProject(createAudioEditorProjectV9({
		id: 'managed-handoff-project',
		title: 'Managed audio handoff',
		revision: 3,
		now: '2026-08-01T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [track],
	}));
	const soundStore = resources.trackStore(createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: soundDatabaseName,
		desktopProjectBridge: serviceBridge(soundService),
		linkedOriginalPort,
	}));
	await soundStore.ready();
	await soundStore.bindLinkedAudioOriginal(project.id, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: externalPcm,
	});
	await soundStore.saveProject(project);
	await soundStore.saveSetting('soundscaper:last-project-id', project.id);

	assert.deepEqual(soundHost.readCatalog().media, [], 'ordinary project saves remain document-only');
	assert.deepEqual(await soundStore.listSources(), [], 'the linked sender must own no PCM source row');
	assert.deepEqual(persistentPcmInventory(indexedDB, soundDatabaseName), {
		sourceChunks: 0,
		sources: 0,
	});
	assert.equal((await soundStore.getSourceMetadata(source.storageKey))?.storage, 'linked-audio-original-v1');
	const soundscaper = resources.trackController(createEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		store: soundStore,
	}));
	assert.equal((await soundscaper.ready).phase, 'ready');
	const soundActions = soundscaper.actions.project as unknown as ProjectActions;
	assert.deepEqual(await soundActions.prepareHandoff(), {
		projectId: project.id,
		revision: project.revision,
	});

	const managedCatalog = soundHost.readCatalog();
	assert.equal(managedCatalog.media.length, 1, 'explicit handoff publishes one managed source');
	assert.equal(managedCatalog.media[0]?.byteLength, MANAGED_PCM_BYTES);
	assert.equal(managedCatalog.media[0]?.sha256, MANAGED_PCM_SHA256);
	assert.match(managedCatalog.media[0]?.relativeFile ?? '', /\.f32c$/u);
	const bundle = await soundService.readSharedProjectBundle(project.id);
	assert.ok(bundle);
	assert.equal(bundle.sources.length, 1);
	const managedSource = bundle.sources[0];
	assert.ok(managedSource);
	assert.equal(managedSource.encoding, 'audio-f32le-chunks-v1');
	assert.equal(managedSource.kind, 'audio');
	assert.equal(managedSource.byteLength, MANAGED_PCM_BYTES);
	assert.equal(managedSource.sha256, MANAGED_PCM_SHA256);
	for (const secret of [LOCATOR_ID, LOCATOR_REVISION]) {
		assert.equal(JSON.stringify({ managedCatalog, bundle }).includes(secret), false);
	}
	const managedBytes = await soundService.readSharedSourceChunk(managedSource.bindingId, {
		offset: 0,
		length: managedSource.byteLength,
	});
	assert.deepEqual(managedBytes, canonicalPcmBytes(PCM_SAMPLES));
	assert.notDeepEqual(managedBytes, externalPcmBytes);
	assert.notEqual(managedSource.sha256, digest(externalPcmBytes));
	assert.notEqual(managedSource.byteLength, externalPcmBytes.byteLength);
	assert.ok(linkedLoads >= 3, 'binding and the two handoff read passes must resolve the linked PCM');
	assert.deepEqual(persistentPcmInventory(indexedDB, soundDatabaseName), {
		sourceChunks: 0,
		sources: 0,
	}, 'managed handoff must not consolidate PCM into the sender store');
	await resources.disposeController(soundscaper);
	await resources.closeStore(soundStore);
	const soundToken = soundHost.snapshot().fencingToken;
	await resources.closeHost(soundHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	assert.ok(frameHost.snapshot().fencingToken > soundToken);
	const frameService = new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 40_000,
		createEntryId: () => { throw new Error('handoff must preserve its shared entry'); },
	});
	const frameStore = resources.trackStore(createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: frameDatabaseName,
		desktopProjectBridge: serviceBridge(frameService),
	}));
	await frameStore.ready();
	assert.equal(await frameStore.getSourceMetadata(source.storageKey), null);
	assert.equal(await frameStore.getLinkedOriginalBinding(project.id, source.id), null);
	assert.deepEqual(await frameStore.listProjectRevisions(project.id), []);
	await frameStore.saveSetting('framescaper:last-project-id', project.id);
	const framescaper = resources.trackController(createEditorController(null, {
		headless: true,
		productId: 'framescaper',
		store: frameStore,
	}));

	const ready = await framescaper.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	const reopened = exactProject(ready.project);
	assert.equal(reopened.id, project.id);
	assert.equal(reopened.revision, project.revision);
	assert.deepEqual(reopened.sources, project.sources);
	assert.deepEqual(reopened.tracks, project.tracks);
	assert.deepEqual(reopened.clips, project.clips);
	assert.deepEqual(await readMonoPcm(frameStore, source.storageKey), PCM_SAMPLES);
	assert.equal((await frameStore.getSourceMetadata(source.storageKey))?.storage, 'indexeddb-chunks');
	assert.deepEqual(persistentPcmInventory(indexedDB, frameDatabaseName), {
		sourceChunks: 1,
		sources: 1,
	});

	await resources.disposeController(framescaper);
	await resources.closeStore(frameStore);
	await resources.closeHost(frameHost);
	const plainStore = resources.trackStore(createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: frameDatabaseName,
	}));
	await plainStore.ready();
	const locallyReopened = exactProject(await plainStore.loadProject(project.id));
	assert.equal(locallyReopened.id, project.id);
	assert.equal(locallyReopened.revision, project.revision);
	assert.equal(await plainStore.getLinkedOriginalBinding(project.id, source.id), null);
	assert.equal((await plainStore.getSourceMetadata(source.storageKey))?.storage, 'indexeddb-chunks');
	assert.deepEqual(await readMonoPcm(plainStore, source.storageKey), PCM_SAMPLES);
	},
);

function int16Bw64Wav(samples: readonly number[]): Uint8Array {
	const encoded = encodeWav([Float32Array.from(samples)], {
		container: 'bw64',
		bitDepth: 16,
		dither: 'none',
		sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'BW64');
	return bytes;
}

function int16Aiff(samples: readonly number[]): Uint8Array {
	const encoded = encodeAiff([Float32Array.from(samples)], {
		sampleFormat: 'int16',
		dither: 'none',
		sampleRate: 48_000,
	});
	assert.ok(encoded instanceof Uint8Array);
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'FORM');
	assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'AIFF');
	return bytes;
}

function float32Aifc(samples: readonly number[]): Uint8Array {
	const encoded = encodeAiff([Float32Array.from(samples)], {
		sampleFormat: 'float32',
		sampleRate: 48_000,
	});
	assert.ok(encoded instanceof Uint8Array);
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'AIFC');
	return bytes;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function serviceBridge(service: DesktopSharedProjectLibraryService): DesktopSharedProjectBridge {
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => service.listSharedProjects(),
		readSharedProject: (projectId: string) => service.readSharedProject(projectId),
		readSharedProjectBundle: (projectId: string) => service.readSharedProjectBundle(projectId),
		commitSharedProject: (document: string) => service.commitSharedProject(document),
		deleteSharedProject: (projectId: string) => service.deleteSharedProject(projectId),
		beginSharedSourceWrite: (declaration) => service.beginSharedSourceWrite(declaration),
		writeSharedSourceChunk: (value) => service.writeSharedSourceChunk(value),
		finishSharedSourceWrite: (value) => service.finishSharedSourceWrite(value),
		abortSharedSourceWrite: (writeId) => service.abortSharedSourceWrite(writeId),
		readSharedSourceChunk: (value) => service.readSharedSourceChunk(
			value.bindingId,
			{ offset: value.offset, length: value.length },
		),
	};
	return Object.freeze(bridge);
}

function exactProject(value: unknown): AudioEditorProjectV9 {
	const project = typeof value === 'string' ? parseScapeProjectDocument(value) : value;
	if (!validateAudioEditorProjectV9(project)) throw new TypeError('Expected an exact-V9 project.');
	if (typeof value === 'string') assert.equal(serializeScapeProjectDocument(project), value);
	return project;
}

async function readMonoPcm(store: AudioEditorProjectStore, sourceId: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const stored of store.readSourceChunks(sourceId, { migrateLegacyPcmOnAccess: false })) {
		const channels = Array.isArray(stored) ? stored : stored.channels;
		assert.equal(channels.length, 1);
		samples.push(...channels[0]);
	}
	return samples;
}

function canonicalPcmBytes(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, samples.length, true);
	for (const [index, sample] of samples.entries()) view.setFloat32(4 + index * 4, sample, true);
	return bytes;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function persistentPcmInventory(
	indexedDB: ReturnType<typeof createInstrumentedIndexedDB>,
	databaseName: string,
) {
	return Object.freeze({
		sourceChunks: indexedDB.recordCount(databaseName, 'sourceChunks'),
		sources: indexedDB.recordCount(databaseName, 'sources'),
	});
}

function trackResources(context: TestContext, appDataPath: string) {
	const controllers = new Set<EditorController>();
	const hosts = new Set<DesktopProjectLibraryHost>();
	const stores = new Set<AudioEditorProjectStore>();
	context.after(async () => {
		const failures: unknown[] = [];
		for (const controller of [...controllers].reverse()) {
			try { await controller.dispose(); } catch (error) { failures.push(error); }
		}
		for (const store of [...stores].reverse()) {
			try { await store.close(); } catch (error) { failures.push(error); }
		}
		for (const host of [...hosts].reverse()) {
			try { await host.close(); } catch (error) { failures.push(error); }
		}
		try { await rm(appDataPath, { recursive: true, force: true }); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Managed handoff fixture cleanup failed');
	});
	return Object.freeze({
		trackController(controller: EditorController): EditorController {
			controllers.add(controller);
			return controller;
		},
		async disposeController(controller: EditorController): Promise<void> {
			await controller.dispose();
			controllers.delete(controller);
		},
		trackStore(store: AudioEditorProjectStore): AudioEditorProjectStore {
			stores.add(store);
			return store;
		},
		async closeStore(store: AudioEditorProjectStore): Promise<void> {
			await store.close();
			stores.delete(store);
		},
		async startHost(owner: DesktopLibraryOwner): Promise<DesktopProjectLibraryHost> {
			const host = await DesktopProjectLibraryHost.start({
				appDataPath,
				owner,
				leaseTtlMs: 5_000,
				renewIntervalMs: 1_000,
			});
			hosts.add(host);
			return host;
		},
		async closeHost(host: DesktopProjectLibraryHost): Promise<void> {
			await host.close();
			hosts.delete(host);
		},
	});
}
