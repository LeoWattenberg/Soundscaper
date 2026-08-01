/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
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
import type { EditorController } from '../src/common/editor/types.ts';

const MANAGED_PCM_BYTES = 20;
const MANAGED_PCM_SHA256 = '6f2c7d30e1887852cdf1ee60c14b93214f029d7fa0de1af6e709972e2d1693c7';
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
	readonly rename: (title: string) => unknown;
	readonly flush: () => Promise<unknown>;
}

test('explicit handoff manages canonical PCM for a fresh Framescaper profile', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-managed-audio-handoff-'));
	const resources = trackResources(context, appDataPath);
	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundService = new DesktopSharedProjectLibraryService(soundHost, {
		now: () => 30_000,
		createEntryId: () => 'managed-handoff-entry-0001',
	});
	const source = createAudioSourceV9({
		id: 'managed-handoff-audio-source',
		storageKey: 'managed-handoff-audio-source',
		name: 'Managed handoff.wav',
		mimeType: 'audio/wav',
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
		indexedDB: null,
		preferOpfs: false,
		databaseName: `managed-handoff-sound-${Date.now()}-${Math.random()}`,
		desktopProjectBridge: serviceBridge(soundService),
	}));
	const writer = await soundStore.beginSourceWrite(source.storageKey, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
	await writer.write([Float32Array.from(PCM_SAMPLES)]);
	await writer.commit({
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
	await soundStore.saveProject(project);
	await soundStore.saveSetting('soundscaper:last-project-id', project.id);

	assert.deepEqual(soundHost.readCatalog().media, [], 'ordinary project saves remain document-only');
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
		indexedDB: null,
		preferOpfs: false,
		databaseName: `managed-handoff-frames-${Date.now()}-${Math.random()}`,
		desktopProjectBridge: serviceBridge(frameService),
	}));
	assert.equal(await frameStore.getSourceMetadata(source.storageKey), null);
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

	const frameActions = framescaper.actions.project as unknown as ProjectActions;
	frameActions.rename('Edited in Framescaper');
	const edited = exactProject(framescaper.getSnapshot().project);
	assert.equal(edited.revision, project.revision + 1);
	await frameActions.flush();
	const sharedEdit = exactProject(await frameService.readSharedProject(project.id));
	assert.equal(sharedEdit.title, 'Edited in Framescaper');
	assert.equal(sharedEdit.revision, project.revision + 1);
	assert.deepEqual(sharedEdit.sources, project.sources);
	assert.equal(frameHost.readCatalog().media.length, 1);
	assert.equal(frameHost.readCatalog().media[0]?.sha256, MANAGED_PCM_SHA256);
});

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
