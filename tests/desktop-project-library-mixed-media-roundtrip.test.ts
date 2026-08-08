/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import {
	createDesktopProjectLibraryPaths,
	type DesktopLibraryOwner,
} from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { DesktopSharedProjectBridge } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { EditorController } from '../src/common/editor/types.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PCM_SAMPLES = Object.freeze([0.125, -0.25, 0.5, -1]);
const VIDEO_BYTES = Uint8Array.of(0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 9, 8, 7, 6, 5, 4, 3, 2, 1);
const INITIAL_SOUND_OWNER = owner('soundscaper', 501, 'mixed-roundtrip-sound-initial');
const FRAME_OWNER = owner('framescaper', 502, 'mixed-roundtrip-frames');
const RETURN_SOUND_OWNER = owner('soundscaper', 503, 'mixed-roundtrip-sound-return');

interface ProjectActions {
	readonly flush: () => Promise<unknown>;
	readonly prepareHandoff: () => Promise<Readonly<{ projectId: string; revision: number }>>;
	readonly rename: (title: string) => unknown;
}

interface BridgeProbe {
	readonly bridge: DesktopSharedProjectBridge;
	readonly bodyReads: Array<Readonly<{ bindingId: string; length: number; offset: number }>>;
	readonly uploadCalls: string[];
}

interface HeadlessEngineProbe {
	readonly engine: Readonly<Record<string, unknown>>;
	readonly samplesFor: (sourceId: string) => readonly (readonly number[])[] | null;
	readonly state: () => 'paused' | 'playing' | 'stopped';
}

interface MixedMediaVisualActions {
	readonly getClipVisualData: (clipId: string) => Readonly<{ available?: boolean; mediaUrl?: string }> | null;
	readonly getProjectBinClipVisualData: (clipId: string) => Readonly<{ available?: boolean; mediaUrl?: string }> | null;
}

interface TransportActions {
	readonly playPause: () => PromiseLike<unknown> | unknown;
	readonly stop: () => PromiseLike<unknown> | unknown;
}

test('mixed media returns to the original Soundscaper profile without copying local media', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-mixed-media-roundtrip-'));
	const resources = trackResources(context, appDataPath);
	const fixture = mixedProjectFixture();
	const soundIndexedDB = createInstrumentedIndexedDB();
	const soundDatabaseName = `mixed-roundtrip-sound-${Date.now()}-${Math.random()}`;

	const initialSoundHost = await resources.startHost(INITIAL_SOUND_OWNER);
	const initialSoundService = resources.trackService(new DesktopSharedProjectLibraryService(initialSoundHost, {
		now: () => 30_000,
		createEntryId: () => 'mixed-roundtrip-entry-0001',
	}));
	const initialSoundStore = resources.trackStore(projectStore(
		soundDatabaseName,
		serviceBridge(initialSoundService).bridge,
		soundIndexedDB,
	));
	await writePcm(initialSoundStore, fixture.audio, PCM_SAMPLES);
	await writeVideo(initialSoundStore, fixture.video, VIDEO_BYTES);
	await initialSoundStore.saveProject(fixture.project);
	await initialSoundStore.saveSetting('soundscaper:last-project-id', fixture.project.id);
	assert.deepEqual(initialSoundHost.readCatalog().media, [], 'ordinary save must remain document-only');

	const initialSoundEngine = createHeadlessEngine();
	const initialSoundscaper = resources.trackController(createEditorController(null, {
		engine: initialSoundEngine.engine,
		headless: true,
		productId: 'soundscaper',
		store: initialSoundStore,
	}));
	const initialReady = await initialSoundscaper.ready;
	assert.equal(initialReady.phase, 'ready', JSON.stringify(initialReady.status));
	assert.deepEqual(exactProject(initialReady.project), fixture.project);
	await assertActivatedMixedMedia(initialSoundscaper, fixture, initialSoundEngine);
	assert.deepEqual(await projectHistory(initialSoundStore, fixture.project.id), [fixture.project]);
	assert.deepEqual(await actions(initialSoundscaper).prepareHandoff(), {
		projectId: fixture.project.id,
		revision: fixture.project.revision,
	});
	assertManagedRevision(initialSoundHost, fixture, 1);
	const initialSoundToken = initialSoundHost.snapshot().lastWriter!.fencingToken;
	await resources.disposeController(initialSoundscaper);
	await resources.closeStore(initialSoundStore);
	await resources.disposeService(initialSoundService);
	await resources.closeHost(initialSoundHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	assert.ok(frameHost.snapshot().lastWriter!.fencingToken > initialSoundToken);
	const frameService = resources.trackService(new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 40_000,
		createEntryId: () => { throw new Error('Framescaper must preserve the shared entry'); },
	}));
	const frameProbe = serviceBridge(frameService);
	const frameStore = resources.trackStore(projectStore(
		`mixed-roundtrip-frame-${Date.now()}-${Math.random()}`,
		frameProbe.bridge,
		null,
	));
	assert.equal(await frameStore.getSourceMetadata(fixture.audio.storageKey), null);
	assert.equal(await frameStore.getMediaAssetMetadata(fixture.video.storageKey), null);
	assert.deepEqual(await frameStore.listProjectRevisions(fixture.project.id), []);
	await frameStore.saveSetting('framescaper:last-project-id', fixture.project.id);
	const frameEngine = createHeadlessEngine();
	const framescaper = resources.trackController(createEditorController(null, {
		engine: frameEngine.engine,
		headless: true,
		productId: 'framescaper',
		store: frameStore,
	}));

	const frameReady = await framescaper.ready;
	assert.equal(frameReady.phase, 'ready', JSON.stringify(frameReady.status));
	assert.deepEqual(exactProject(frameReady.project), fixture.project);
	await assertActivatedMixedMedia(framescaper, fixture, frameEngine);
	assert.deepEqual(await projectHistory(frameStore, fixture.project.id), [fixture.project]);
	await assertExactLocalMedia(frameStore, fixture);
	assert.deepEqual(new Set(frameProbe.bodyReads.map(({ bindingId }) => bindingId[0])), new Set(['m', 'v']));
	assertManagedRevision(frameHost, fixture, 1, 'fresh acquisition must not publish shared media');

	actions(framescaper).rename('Mixed picture edit in Framescaper');
	const frameEdit = exactProject(framescaper.getSnapshot().project);
	assert.deepEqual(frameEdit, {
		...fixture.project,
		title: 'Mixed picture edit in Framescaper',
		revision: fixture.project.revision + 1,
		updatedAt: frameEdit.updatedAt,
	});
	await actions(framescaper).flush();
	assert.deepEqual(exactProject(await frameService.readSharedProject(fixture.project.id)), frameEdit);
	assert.deepEqual(await projectHistory(frameStore, fixture.project.id), [frameEdit, fixture.project]);
	assertManagedRevision(frameHost, fixture, 1, 'ordinary revised save must remain document-only');

	assert.deepEqual(await actions(framescaper).prepareHandoff(), {
		projectId: fixture.project.id,
		revision: frameEdit.revision,
	});
	assert.deepEqual(
		frameProbe.uploadCalls,
		['begin', 'begin'],
		'unchanged revision-bound media must be rebound without uploading either body',
	);
	assertManagedRevision(frameHost, fixture, 2);
	await assertManagedBodiesReused(appDataPath, frameHost, fixture);
	const returnedBundle = await frameService.readSharedProjectBundle(fixture.project.id);
	assert.ok(returnedBundle);
	assert.deepEqual(exactProject(returnedBundle.document), frameEdit);
	assert.deepEqual(returnedBundle.sources.map(({ kind, sha256, sourceId, storageKey }) => ({
		kind, sha256, sourceId, storageKey,
	})), fixture.managedSources);
	const frameToken = frameHost.snapshot().lastWriter!.fencingToken;
	await resources.disposeController(framescaper);
	await resources.closeStore(frameStore);
	await resources.disposeService(frameService);
	await resources.closeHost(frameHost);

	const beforeReturnInventory = persistentInventory(soundIndexedDB, soundDatabaseName);
	assert.deepEqual(beforeReturnInventory, {
		mediaAssetChunks: 1,
		mediaAssets: 1,
		sourceChunks: 1,
		sources: 1,
	});
	const returnSoundHost = await resources.startHost(RETURN_SOUND_OWNER);
	assert.ok(returnSoundHost.snapshot().lastWriter!.fencingToken > frameToken);
	assert.equal(returnSoundHost.snapshot().lastWriter!.managedMediaReclamation.catalogRowsRetired, 2);
	assert.equal(returnSoundHost.snapshot().lastWriter!.managedMediaReclamation.reclaimedFiles, 2);
	const returnSoundService = resources.trackService(new DesktopSharedProjectLibraryService(returnSoundHost, {
		now: () => 50_000,
		createEntryId: () => { throw new Error('return must preserve the shared entry'); },
	}));
	const returnProbe = serviceBridge(returnSoundService);
	const returnSoundStore = resources.trackStore(projectStore(
		soundDatabaseName,
		returnProbe.bridge,
		soundIndexedDB,
	));
	assert.equal(await returnSoundStore.loadSetting('soundscaper:last-project-id', null), fixture.project.id);
	assert.deepEqual(await projectHistory(returnSoundStore, fixture.project.id), [fixture.project]);
	await assertExactLocalMedia(returnSoundStore, fixture);
	const returnSoundEngine = createHeadlessEngine();
	const returnedSoundscaper = resources.trackController(createEditorController(null, {
		engine: returnSoundEngine.engine,
		headless: true,
		productId: 'soundscaper',
		store: returnSoundStore,
	}));

	const returnedReady = await returnedSoundscaper.ready;
	assert.equal(returnedReady.phase, 'ready', JSON.stringify(returnedReady.status));
	assert.deepEqual(exactProject(returnedReady.project), frameEdit);
	await assertActivatedMixedMedia(returnedSoundscaper, fixture, returnSoundEngine);
	assert.deepEqual(await projectHistory(returnSoundStore, fixture.project.id), [frameEdit, fixture.project]);
	await assertExactLocalMedia(returnSoundStore, fixture);
	assert.deepEqual(returnProbe.bodyReads, [], 'matching original-profile media must not be copied from shared storage');
	assert.deepEqual(returnProbe.uploadCalls, [], 'return activation must not upload original-profile media');
	assert.deepEqual(persistentInventory(soundIndexedDB, soundDatabaseName), beforeReturnInventory);
	assertManagedRevision(returnSoundHost, fixture, 1, 'return activation must not publish or duplicate media');
});

function mixedProjectFixture() {
	const audio = createAudioSourceV9({
		id: 'roundtrip-audio-source', storageKey: 'physical/roundtrip-audio-pcm', name: 'Roundtrip audio.wav',
		mimeType: 'audio/wav', frameCount: PCM_SAMPLES.length, channelCount: 1, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: PCM_SAMPLES.length,
	});
	const video = createVideoSourceV9({
		id: 'roundtrip-video-source', storageKey: 'physical/roundtrip-original-video', name: 'Roundtrip picture.mp4',
		mimeType: 'video/mp4', frameCount: 48_000, sampleRate: 48_000, width: 1_920, height: 1_080,
		frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const audioClip = createAudioClipV9({
		id: 'roundtrip-audio-clip', sourceId: audio.id, title: 'Exact PCM',
		durationFrames: PCM_SAMPLES.length, sourceDurationFrames: PCM_SAMPLES.length,
	});
	const videoClip = createVideoClipV9({
		id: 'roundtrip-video-clip', sourceId: video.id, title: 'Original picture',
		durationFrames: 48_000, sourceDurationFrames: 48_000,
	});
	const binClip = createVideoClipV9({
		id: 'roundtrip-bin-video', binItemId: 'roundtrip-bin-item', sourceId: video.id,
		title: 'Original picture master', durationFrames: 48_000, sourceDurationFrames: 48_000,
	});
	const project = exactProject(createAudioEditorProjectV9({
		id: 'mixed-media-roundtrip-project', title: 'Mixed media roundtrip', revision: 3,
		now: '2026-08-01T12:00:00.000Z', sampleRate: 48_000,
		sources: [audio, video], clips: [audioClip, videoClip],
		tracks: [
			createAudioTrackV9({ id: 'roundtrip-audio-track', name: 'Sound', clipIds: [audioClip.id] }),
			createVideoTrackV9({ id: 'roundtrip-video-track', name: 'Picture', clipIds: [videoClip.id] }),
		],
		projectBin: { clips: [binClip] },
		opaqueExtensions: { editorialNote: 'history-visible mixed-media state' },
	}));
	return Object.freeze({
		audio,
		binClip,
		managedSources: Object.freeze([
			{ kind: 'audio', sha256: canonicalPcmDigest(PCM_SAMPLES), sourceId: audio.id, storageKey: audio.storageKey },
			{ kind: 'video', sha256: digest(VIDEO_BYTES), sourceId: video.id, storageKey: video.storageKey },
		]),
		project,
		video,
		videoClip,
	});
}

function serviceBridge(service: DesktopSharedProjectLibraryService): BridgeProbe {
	const bodyReads: BridgeProbe['bodyReads'] = [];
	const uploadCalls: string[] = [];
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => service.listSharedProjects(),
		readSharedProject: (projectId: string) => service.readSharedProject(projectId),
		readSharedProjectBundle: (projectId: string) => service.readSharedProjectBundle(projectId),
		commitSharedProject: (request) => service.commitSharedProject(request),
		deleteSharedProject: (projectId: string) => service.deleteSharedProject(projectId),
		beginSharedSourceWrite: (declaration) => {
			uploadCalls.push('begin');
			return service.beginSharedSourceWrite(declaration);
		},
		writeSharedSourceChunk: (value) => {
			uploadCalls.push('write');
			return service.writeSharedSourceChunk(value);
		},
		finishSharedSourceWrite: (value) => {
			uploadCalls.push('finish');
			return service.finishSharedSourceWrite(value);
		},
		abortSharedSourceWrite: (writeId) => {
			uploadCalls.push('abort');
			return service.abortSharedSourceWrite(writeId);
		},
		readSharedSourceChunk: (value) => {
			bodyReads.push(value);
			return service.readSharedSourceChunk(value.bindingId, { offset: value.offset, length: value.length });
		},
	};
	return Object.freeze({
		bodyReads,
		bridge: Object.freeze(bridge),
		uploadCalls,
	});
}

function projectStore(databaseName: string, bridge: DesktopSharedProjectBridge, indexedDB: unknown) {
	return createProjectStore({
		databaseName,
		desktopProjectBridge: bridge,
		indexedDB,
		memoryFallback: indexedDB === null,
		preferOpfs: false,
	});
}

async function writePcm(store: AudioEditorProjectStore, source: Record<string, unknown>, samples: readonly number[]) {
	const writer = await store.beginSourceWrite(String(source.storageKey), {
		name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate,
		channelCount: source.channelCount, chunkFrames: source.chunkFrames,
	});
	await writer.write([Float32Array.from(samples)]);
	await writer.commit({
		sampleRate: source.sampleRate, channelCount: source.channelCount, chunkFrames: source.chunkFrames,
	});
}

async function writeVideo(store: AudioEditorProjectStore, source: Record<string, unknown>, bytes: Uint8Array) {
	const writer = await store.beginMediaAssetWrite(String(source.storageKey), {
		name: source.name, mimeType: source.mimeType,
	}, { expectedBytes: bytes.byteLength, expectedSha256: digest(bytes) });
	await writer.write(bytes.subarray(0, 8));
	await writer.write(bytes.subarray(8));
	await writer.commit();
}

async function assertExactLocalMedia(store: AudioEditorProjectStore, fixture: ReturnType<typeof mixedProjectFixture>) {
	assert.deepEqual(await readMonoPcm(store, fixture.audio.storageKey), PCM_SAMPLES);
	const video = await store.loadMediaAsset(fixture.video.storageKey, { backfillDigest: false });
	assert.ok(video);
	assert.deepEqual(new Uint8Array(await video.arrayBuffer()), VIDEO_BYTES);
	assert.equal((await store.getMediaAssetMetadata(fixture.video.storageKey))?.sha256, digest(VIDEO_BYTES));
	assert.deepEqual((await store.listSources()).map(({ id }) => id), [fixture.audio.storageKey]);
}

async function assertActivatedMixedMedia(
	controller: EditorController,
	fixture: ReturnType<typeof mixedProjectFixture>,
	engine: HeadlessEngineProbe,
): Promise<void> {
	assert.deepEqual(
		controller.getSnapshot().missingSourceIds,
		[],
		JSON.stringify(controller.getSnapshot().status),
	);
	const visualActions = controller as unknown as MixedMediaVisualActions;
	const timeline = visualActions.getClipVisualData(String(fixture.videoClip.id));
	const projectBin = visualActions.getProjectBinClipVisualData(String(fixture.binClip.id));
	assert.equal(timeline?.available, true);
	assert.equal(projectBin?.available, true);
	const mediaUrl = timeline?.mediaUrl;
	assert.ok(typeof mediaUrl === 'string' && mediaUrl.startsWith('blob:'));
	if (typeof mediaUrl !== 'string') throw new TypeError('Activated video requires a blob URL');
	assert.equal(projectBin?.mediaUrl, mediaUrl);
	const response = await fetch(mediaUrl);
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), VIDEO_BYTES);
	assert.deepEqual(engine.samplesFor(fixture.audio.id), [PCM_SAMPLES]);
	const transport = controller.actions.transport as unknown as TransportActions;
	await transport.playPause();
	assert.equal(engine.state(), 'playing');
	await transport.stop();
	assert.equal(engine.state(), 'stopped');
}

function createHeadlessEngine(): HeadlessEngineProbe {
	const appliedSources = new Map<string, readonly (readonly number[])[]>();
	let positionFrame = 0;
	let state: 'paused' | 'playing' | 'stopped' = 'stopped';
	const captureBuffers = (buffers: unknown): void => {
		appliedSources.clear();
		if (!(buffers instanceof Map)) return;
		for (const [sourceId, buffer] of buffers) {
			if (typeof sourceId !== 'string' || !(buffer instanceof HeadlessAudioBuffer)) continue;
			appliedSources.set(sourceId, Object.freeze(Array.from(
				{ length: buffer.numberOfChannels },
				(_, channel) => Object.freeze([...buffer.getChannelData(channel)]),
			)));
		}
	};
	const engine = Object.freeze({
		setSourceResolver() { return this; },
		loadProject(_project: unknown, buffers: unknown) { captureBuffers(buffers); },
		async applyProject(_project: unknown, buffers: unknown) {
			captureBuffers(buffers);
		},
		async getAudioContext() {
			return Object.freeze({
				createBuffer: (channelCount: number, frameCount: number, sampleRate: number) => (
					new HeadlessAudioBuffer(channelCount, frameCount, sampleRate)
				),
			});
		},
		getPositionFrames() { return positionFrame; },
		getState() { return Object.freeze({ state, loop: Object.freeze({ enabled: false }) }); },
		play() { state = 'playing'; },
		pause() { state = 'paused'; },
		stop() { state = 'stopped'; positionFrame = 0; },
		seek(frame: number) { positionFrame = Math.max(0, Math.round(frame)); return positionFrame; },
		setLoop() {},
		async dispose() { state = 'stopped'; },
	});
	return Object.freeze({
		engine,
		samplesFor(sourceId: string) { return appliedSources.get(sourceId) ?? null; },
		state: () => state,
	});
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

async function readMonoPcm(store: AudioEditorProjectStore, storageKey: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const stored of store.readSourceChunks(storageKey, { migrateLegacyPcmOnAccess: false })) {
		const channels = Array.isArray(stored) ? stored : stored.channels;
		assert.equal(channels.length, 1);
		samples.push(...channels[0]);
	}
	return samples;
}

function assertManagedRevision(
	host: DesktopProjectLibraryHost,
	fixture: ReturnType<typeof mixedProjectFixture>,
	revisionCount: number,
	message = 'managed catalog must contain one binding per source and explicit handoff revision',
): void {
	const media = host.readCatalog().media;
	assert.equal(media.length, fixture.managedSources.length * revisionCount, message);
	assert.equal(new Set(media.map(({ id }) => id)).size, media.length, 'managed binding identities must be unique');
	for (const expected of fixture.managedSources) {
		assert.equal(media.filter(({ sha256 }) => sha256 === expected.sha256).length, revisionCount);
	}
}

async function assertManagedBodiesReused(
	appDataPath: string,
	host: DesktopProjectLibraryHost,
	fixture: ReturnType<typeof mixedProjectFixture>,
): Promise<void> {
	const root = createDesktopProjectLibraryPaths(appDataPath).managedMediaRoot;
	for (const expected of fixture.managedSources) {
		const rows = host.readCatalog().media.filter(({ sha256 }) => sha256 === expected.sha256);
		assert.equal(rows.length, 2);
		const [first, second] = await Promise.all(rows.map(({ relativeFile }) => (
			stat(join(root, ...relativeFile.split('/')))
		)));
		assert.ok(first && second);
		assert.equal(second.dev, first.dev);
		assert.equal(second.ino, first.ino, `${expected.kind} revisions must share one immutable body`);
		assert.ok(first.nlink >= 2 && second.nlink >= 2);
	}
}

async function projectHistory(store: AudioEditorProjectStore, projectId: string): Promise<AudioEditorProjectV9[]> {
	return (await store.listProjectRevisions(projectId)).map(({ project }) => exactProject(project));
}

function exactProject(value: unknown): AudioEditorProjectV9 {
	const project = typeof value === 'string' ? parseScapeProjectDocument(value) : value;
	if (!validateAudioEditorProjectV9(project)) throw new TypeError('Expected an exact-V9 project.');
	if (typeof value === 'string') assert.equal(serializeScapeProjectDocument(project), value);
	return project;
}

function actions(controller: EditorController): ProjectActions {
	return controller.actions.project as unknown as ProjectActions;
}

function canonicalPcmDigest(samples: readonly number[]): string {
	const bytes = new Uint8Array(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, samples.length, true);
	for (const [index, sample] of samples.entries()) view.setFloat32(4 + index * 4, sample, true);
	return digest(bytes);
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function persistentInventory(indexedDB: ReturnType<typeof createInstrumentedIndexedDB>, databaseName: string) {
	return Object.freeze({
		mediaAssetChunks: indexedDB.recordCount(databaseName, 'mediaAssetChunks'),
		mediaAssets: indexedDB.recordCount(databaseName, 'mediaAssets'),
		sourceChunks: indexedDB.recordCount(databaseName, 'sourceChunks'),
		sources: indexedDB.recordCount(databaseName, 'sources'),
	});
}

function owner(product: 'framescaper' | 'soundscaper', processId: number, instanceId: string): DesktopLibraryOwner {
	return Object.freeze({ product, processId, instanceId });
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
		if (failures.length) throw new AggregateError(failures, 'Mixed handoff fixture cleanup failed');
	});
	return Object.freeze({
		trackController(controller: EditorController) { controllers.add(controller); return controller; },
		async disposeController(controller: EditorController) { await controller.dispose(); controllers.delete(controller); },
		trackHost(host: DesktopProjectLibraryHost) { hosts.add(host); return host; },
		async startHost(ownerValue: DesktopLibraryOwner) {
			return this.trackHost(await DesktopProjectLibraryHost.start({
				appDataPath, owner: ownerValue, leaseTtlMs: 5_000, renewIntervalMs: 1_000,
			}));
		},
		async closeHost(host: DesktopProjectLibraryHost) { await host.close(); hosts.delete(host); },
		trackService(service: DesktopSharedProjectLibraryService) { services.add(service); return service; },
		async disposeService(service: DesktopSharedProjectLibraryService) { await service.dispose(); services.delete(service); },
		trackStore(store: AudioEditorProjectStore) { stores.add(store); return store; },
		async closeStore(store: AudioEditorProjectStore) { await store.close(); stores.delete(store); },
	});
}
