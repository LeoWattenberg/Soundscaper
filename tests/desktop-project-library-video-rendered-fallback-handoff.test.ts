/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import type { DesktopLibraryOwner } from '../desktop/project-library-contract.ts';
import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioEditorProjectV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { DesktopSharedProjectBridge } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { EditorController } from '../src/common/editor/types.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const ORIGINAL_BYTES = Uint8Array.of(0, 0, 0, 24, 102, 116, 121, 112, 111, 114, 105, 103);
const FALLBACK_BYTES = Uint8Array.of(0, 0, 0, 24, 102, 116, 121, 112, 102, 97, 108, 108);
const FRAME_OWNER = owner('framescaper', 701, 'video-fallback-handoff-frame');
const SOUND_OWNER = owner('soundscaper', 702, 'video-fallback-handoff-sound');

interface BridgeProbe {
	readonly bodyReads: Array<Readonly<{ bindingId: string; length: number; offset: number }>>;
	readonly bridge: DesktopSharedProjectBridge;
}

interface HeadlessEngineProbe {
	readonly engine: Readonly<Record<string, unknown>>;
	readonly project: () => AudioEditorProjectV9 | null;
	readonly state: () => 'paused' | 'playing' | 'stopped';
}

interface ProjectActions {
	readonly prepareHandoff: () => Promise<Readonly<{ projectId: string; revision: number }>>;
}

interface TransportActions {
	readonly playPause: () => PromiseLike<unknown> | unknown;
}

interface VideoActions {
	readonly getSourceVisualData: (sourceId: string) => Readonly<{ mediaUrl?: string | null }> | null;
}

test('fresh Soundscaper acquires and plays a managed first-party video rendered fallback', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-video-fallback-handoff-'));
	const resources = trackResources(context, appDataPath);
	const fixture = fallbackProjectFixture();

	const frameHost = await resources.startHost(FRAME_OWNER);
	const frameService = resources.trackService(new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 80_000,
		createEntryId: () => 'video-fallback-handoff-entry-0001',
	}));
	const frameStore = resources.trackStore(projectStore(
		`video-fallback-handoff-frame-${Date.now()}-${Math.random()}`,
		serviceBridge(frameService).bridge,
	));
	await writeVideo(frameStore, fixture.original, ORIGINAL_BYTES);
	await writeVideo(frameStore, fixture.fallback, FALLBACK_BYTES);
	await frameStore.saveProject(fixture.project);
	await frameStore.saveSetting('framescaper:last-project-id', fixture.project.id);
	assert.deepEqual(frameHost.readCatalog().media, [], 'ordinary save remains document-only');
	const framescaper = resources.trackController(createEditorController(null, {
		engine: createHeadlessEngine().engine,
		headless: true,
		productId: 'framescaper',
		store: frameStore,
	}));
	const frameReady = await framescaper.ready;
	assert.equal(frameReady.phase, 'ready', JSON.stringify(frameReady.status));
	assert.equal(frameReady.readOnly, false);
	assert.deepEqual(await projectActions(framescaper).prepareHandoff(), {
		projectId: fixture.project.id,
		revision: fixture.project.revision,
	});
	const frameBundle = await frameService.readSharedProjectBundle(fixture.project.id);
	assert.ok(frameBundle);
	assert.deepEqual(frameBundle.sources.map(({ kind, sha256, sourceId, storageKey }) => ({
		kind, sha256, sourceId, storageKey,
	})), fixture.managedSources);
	assert.equal(frameHost.readCatalog().media.length, 2);
	await resources.disposeController(framescaper);
	await resources.closeStore(frameStore);
	await resources.disposeService(frameService);
	await resources.closeHost(frameHost);

	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundService = resources.trackService(new DesktopSharedProjectLibraryService(soundHost, {
		now: () => 90_000,
		createEntryId: () => { throw new Error('Soundscaper must preserve the shared entry'); },
	}));
	const soundProbe = serviceBridge(soundService);
	const soundStore = resources.trackStore(projectStore(
		`video-fallback-handoff-sound-${Date.now()}-${Math.random()}`,
		soundProbe.bridge,
	));
	assert.equal(await soundStore.getMediaAssetMetadata(fixture.original.storageKey), null);
	assert.equal(await soundStore.getMediaAssetMetadata(fixture.fallback.storageKey), null);
	assert.deepEqual(await soundStore.listProjectRevisions(fixture.project.id), []);
	await soundStore.saveSetting('soundscaper:last-project-id', fixture.project.id);
	const engine = createHeadlessEngine();
	const soundscaper = resources.trackController(createEditorController(null, {
		engine: engine.engine,
		headless: true,
		productId: 'soundscaper',
		store: soundStore,
	}));

	const ready = await soundscaper.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.readOnly, true);
	assert.equal(
		serializeScapeProjectDocument(ready.project),
		serializeScapeProjectDocument(fixture.project),
		'the canonical project must remain the original editable document',
	);
	assert.equal(
		[...fixture.project.clips, ...fixture.project.projectBin.clips]
			.some(({ sourceId }) => sourceId === fixture.fallback.id),
		false,
		'the fallback source must be reachable only from its feature requirement',
	);
	assert.deepEqual(soundscaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(await readVideo(soundStore, fixture.original.storageKey), ORIGINAL_BYTES);
	assert.deepEqual(await readVideo(soundStore, fixture.fallback.storageKey), FALLBACK_BYTES);
	assert.deepEqual(
		new Set(soundProbe.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(frameBundle.sources.map(({ bindingId }) => bindingId)),
	);
	const shadow = await soundStore.loadProject(fixture.project.id, { revision: fixture.project.revision });
	assert.equal(
		serializeScapeProjectDocument(shadow),
		serializeScapeProjectDocument(fixture.project),
	);

	const playbackProject = engine.project();
	assert.ok(playbackProject);
	assert.deepEqual(playbackProject.tracks.map(({ id }) => id), [
		PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
	]);
	assert.deepEqual(playbackProject.clips.map(({ id, sourceId }) => ({ id, sourceId })), [{
		id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
		sourceId: fixture.fallback.id,
	}]);
	const snapshot = soundscaper.getSnapshot() as typeof ready & Readonly<{
		videoRenderedFallback?: Readonly<{ sourceId?: string }> | null;
	}>;
	assert.equal(snapshot.videoRenderedFallback?.sourceId, fixture.fallback.id);
	const visual = videoActions(soundscaper).getSourceVisualData(fixture.fallback.id);
	assert.ok(visual?.mediaUrl);
	assert.deepEqual(new Uint8Array(await (await fetch(visual.mediaUrl)).arrayBuffer()), FALLBACK_BYTES);

	await transportActions(soundscaper).playPause();
	assert.equal(engine.state(), 'playing');
});

function fallbackProjectFixture() {
	const original = createVideoSourceV9({
		id: 'video-fallback-handoff-original', storageKey: 'physical/video-fallback-handoff-original',
		name: 'Editable original.mp4', mimeType: 'video/mp4', frameCount: 120,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const fallback = createVideoSourceV9({
		id: 'video-fallback-handoff-render', storageKey: 'physical/video-fallback-handoff-render',
		name: 'Rendered fallback.mp4', mimeType: 'video/mp4', frameCount: 120,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 30,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const clip = createVideoClipV9({
		id: 'video-fallback-handoff-original-clip', sourceId: original.id,
		title: 'Editable original', durationFrames: original.frameCount,
		sourceDurationFrames: original.frameCount,
		videoEffects: [createVideoEffect('pixelate', { id: 'video-fallback-handoff-pixelate' })],
	});
	const fallbackSha256 = digest(FALLBACK_BYTES);
	const project = createAudioEditorProjectV9({
		id: 'video-rendered-fallback-handoff', title: 'Video rendered fallback handoff', revision: 4,
		now: '2026-08-02T12:00:00.000Z', sampleRate: 48_000,
		sources: [original, fallback], clips: [clip],
		tracks: [createVideoTrackV9({
			id: 'video-fallback-handoff-original-track', name: 'Editable effects', clipIds: [clip.id],
		})],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-video-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
			displayName: 'Publisher video render',
			disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: fallback.id, sha256: fallbackSha256 },
		}] },
	});
	return Object.freeze({
		fallback,
		managedSources: Object.freeze([
			{ kind: 'video', sha256: digest(ORIGINAL_BYTES), sourceId: original.id, storageKey: original.storageKey },
			{ kind: 'video', sha256: fallbackSha256, sourceId: fallback.id, storageKey: fallback.storageKey },
		]),
		original,
		project,
	});
}

function serviceBridge(service: DesktopSharedProjectLibraryService): BridgeProbe {
	const bodyReads: BridgeProbe['bodyReads'] = [];
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => service.listSharedProjects(),
		readSharedProject: (projectId: string) => service.readSharedProject(projectId),
		readSharedProjectBundle: (projectId: string) => service.readSharedProjectBundle(projectId),
		commitSharedProject: (document: string) => service.commitSharedProject(document),
		deleteSharedProject: (projectId: string) => service.deleteSharedProject(projectId),
		beginSharedSourceWrite: (value) => service.beginSharedSourceWrite(value),
		writeSharedSourceChunk: (value) => service.writeSharedSourceChunk(value),
		finishSharedSourceWrite: (value) => service.finishSharedSourceWrite(value),
		abortSharedSourceWrite: (writeId) => service.abortSharedSourceWrite(writeId),
		readSharedSourceChunk: (value) => {
			bodyReads.push(value);
			return service.readSharedSourceChunk(value.bindingId, {
				offset: value.offset,
				length: value.length,
			});
		},
	};
	return Object.freeze({ bodyReads, bridge: Object.freeze(bridge) });
}

function projectStore(databaseName: string, bridge: DesktopSharedProjectBridge) {
	return createProjectStore({
		databaseName,
		desktopProjectBridge: bridge,
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
	});
}

async function writeVideo(
	store: AudioEditorProjectStore,
	source: ReturnType<typeof createVideoSourceV9>,
	bytes: Uint8Array,
): Promise<void> {
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	await store.writeMediaAsset(
		source.storageKey,
		new Blob([body], { type: source.mimeType }),
		{ name: source.name, mimeType: source.mimeType },
	);
}

async function readVideo(store: AudioEditorProjectStore, storageKey: string): Promise<Uint8Array> {
	const blob = await store.loadMediaAsset(storageKey, { backfillDigest: false });
	if (!blob) throw new Error(`Video ${storageKey} is missing`);
	return new Uint8Array(await blob.arrayBuffer());
}

function createHeadlessEngine(): HeadlessEngineProbe {
	let appliedProject: AudioEditorProjectV9 | null = null;
	let state: 'paused' | 'playing' | 'stopped' = 'stopped';
	const engine = Object.freeze({
		setSourceResolver() { return this; },
		loadProject(project: unknown) { appliedProject = project as AudioEditorProjectV9; },
		async applyProject(project: unknown) { appliedProject = project as AudioEditorProjectV9; },
		async getAudioContext() {
			return Object.freeze({
				createBuffer: (channelCount: number, frameCount: number, sampleRate: number) => (
					new HeadlessAudioBuffer(channelCount, frameCount, sampleRate)
				),
			});
		},
		getPositionFrames() { return 0; },
		getState() { return Object.freeze({ state, loop: Object.freeze({ enabled: false }) }); },
		play() { state = 'playing'; },
		pause() { state = 'paused'; },
		stop() { state = 'stopped'; },
		seek(frame: number) { return Math.max(0, Math.round(frame)); },
		setLoop() {},
		async dispose() { state = 'stopped'; },
	});
	return Object.freeze({ engine, project: () => appliedProject, state: () => state });
}

class HeadlessAudioBuffer {
	readonly #channels: readonly Float32Array[];
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;

	constructor(numberOfChannels: number, length: number, sampleRate: number) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.#channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel: number): Float32Array {
		const values = this.#channels[channel];
		if (!values) throw new RangeError('Headless audio-buffer channel is unavailable');
		return values;
	}

	copyToChannel(values: Float32Array, channel: number, offset = 0): void {
		this.getChannelData(channel).set(values, offset);
	}
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function owner(product: 'framescaper' | 'soundscaper', processId: number, instanceId: string): DesktopLibraryOwner {
	return Object.freeze({ product, processId, instanceId });
}

function projectActions(controller: EditorController): ProjectActions {
	return controller.actions.project as unknown as ProjectActions;
}

function transportActions(controller: EditorController): TransportActions {
	return controller.actions.transport as unknown as TransportActions;
}

function videoActions(controller: EditorController): VideoActions {
	return controller.actions.video as unknown as VideoActions;
}

function trackResources(context: TestContext, appDataPath: string) {
	const controllers = new Set<EditorController>();
	const hosts = new Set<DesktopProjectLibraryHost>();
	const services = new Set<DesktopSharedProjectLibraryService>();
	const stores = new Set<AudioEditorProjectStore>();
	context.after(async () => {
		const failures: unknown[] = [];
		for (const controller of [...controllers].reverse()) try { await controller.dispose(); } catch (error) { failures.push(error); }
		for (const store of [...stores].reverse()) try { await store.close(); } catch (error) { failures.push(error); }
		for (const service of [...services].reverse()) try { await service.dispose(); } catch (error) { failures.push(error); }
		for (const host of [...hosts].reverse()) try { await host.close(); } catch (error) { failures.push(error); }
		try { await rm(appDataPath, { recursive: true, force: true }); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Video fallback handoff fixture cleanup failed');
	});
	return Object.freeze({
		trackController(controller: EditorController) { controllers.add(controller); return controller; },
		trackHost(host: DesktopProjectLibraryHost) { hosts.add(host); return host; },
		trackService(service: DesktopSharedProjectLibraryService) { services.add(service); return service; },
		trackStore(store: AudioEditorProjectStore) { stores.add(store); return store; },
		async startHost(ownerValue: DesktopLibraryOwner) {
			return this.trackHost(await DesktopProjectLibraryHost.start({
				appDataPath, owner: ownerValue, leaseTtlMs: 5_000, renewIntervalMs: 1_000,
			}));
		},
		async disposeController(controller: EditorController) { await controller.dispose(); controllers.delete(controller); },
		async closeHost(host: DesktopProjectLibraryHost) { await host.close(); hosts.delete(host); },
		async disposeService(service: DesktopSharedProjectLibraryService) { await service.dispose(); services.delete(service); },
		async closeStore(store: AudioEditorProjectStore) { await store.close(); stores.delete(store); },
	});
}
