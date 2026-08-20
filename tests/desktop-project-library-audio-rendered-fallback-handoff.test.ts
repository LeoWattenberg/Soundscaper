/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

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
import { createEffect } from '../src/common/editor/effects.js';
import type { EngineChunkSource, EngineChunkReadValue } from '../src/common/editor/engine/types.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { normalizeProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import type { DesktopSharedProjectBridge } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { EditorController } from '../src/common/editor/types.ts';
import { streamWavBlobPcm } from '../src/common/editor/wav-import.js';

const ORIGINAL_CHANNELS = Object.freeze([
	Object.freeze([0.125, -0.25, 0.5, -1]),
	Object.freeze([-0.125, 0.25, -0.5, 1]),
]);
const FALLBACK_CHANNELS = Object.freeze([
	Object.freeze([0.75, 0.5, 0.25, 0, -0.25, -0.5]),
	Object.freeze([-0.75, -0.5, -0.25, 0, 0.25, 0.5]),
]);
const CORRUPT_FALLBACK_CHANNELS = Object.freeze([
	Object.freeze([0.75, 0.5, 0.25, 0, -0.25, -0.25]),
	Object.freeze([-0.75, -0.5, -0.25, 0, 0.25, 0.25]),
]);
const AUDIO_EXPORT_SETTINGS = Object.freeze({
	bitDepth: 32, dither: 'none', format: 'wav', includeTail: false,
	mode: 'mix', sampleFormat: 'float32',
});
const UNKNOWN_AUDIO_FEATURE_ID = 'org.example.future-mixer';
const SOUND_OWNER = owner('soundscaper', 601, 'fallback-handoff-sound');
const FRAME_OWNER = owner('framescaper', 602, 'fallback-handoff-frame');

interface BridgeProbe {
	readonly bodyReads: Array<Readonly<{ bindingId: string; length: number; offset: number }>>;
	readonly bridge: DesktopSharedProjectBridge;
}

interface HeadlessEngineProbe {
	readonly engine: Readonly<Record<string, unknown>>;
	readonly project: () => AudioEditorProjectCurrent | null;
	readonly samplesFor: (sourceId: string) => readonly (readonly number[])[] | null;
	readonly state: () => 'paused' | 'playing' | 'stopped';
}

interface ProjectActions {
	readonly prepareHandoff: () => Promise<Readonly<{ projectId: string; revision: number }>>;
}

interface TransportActions {
	readonly playPause: () => PromiseLike<unknown> | unknown;
}

interface ExportActions {
	readonly start: (settings?: Readonly<Record<string, unknown>>) => Promise<Readonly<{
		fileName?: string;
		mimeType?: string;
	}> | undefined>;
}

test('fresh Framescaper acquires, plays, and delivers an unknown-feature audio fallback', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-audio-fallback-handoff-'));
	const resources = trackResources(context, appDataPath);
	const fixture = fallbackProjectFixture();

	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundService = resources.trackService(new DesktopSharedProjectLibraryService(soundHost, {
		now: () => 60_000,
		createEntryId: () => 'fallback-handoff-entry-0001',
	}));
	const soundStore = resources.trackStore(projectStore(
		`fallback-handoff-sound-${Date.now()}-${Math.random()}`,
		serviceBridge(soundService).bridge,
	));
	await writePcm(soundStore, fixture.original, ORIGINAL_CHANNELS);
	await writePcm(soundStore, fixture.fallback, FALLBACK_CHANNELS);
	await soundStore.saveProject(fixture.project);
	await soundStore.saveSetting('soundscaper:last-project-id', fixture.project.id);
	assert.deepEqual(soundHost.readCatalog().media, [], 'ordinary save remains document-only');
	const soundscaper = resources.trackController(createEditorController(null, {
		engine: createHeadlessEngine().engine,
		headless: true,
		productId: 'soundscaper',
		store: soundStore,
	}));
	const soundReady = await soundscaper.ready;
	assert.equal(soundReady.phase, 'ready', JSON.stringify(soundReady.status));
	assert.equal(soundReady.readOnly, true);
	assert.deepEqual(await projectActions(soundscaper).prepareHandoff(), {
		projectId: fixture.project.id,
		revision: fixture.project.revision,
	});
	const soundBundle = await soundService.readSharedProjectBundle(fixture.project.id);
	assert.ok(soundBundle);
	assert.deepEqual(soundBundle.sources.map(({ kind, sha256, sourceId, storageKey }) => ({
		kind, sha256, sourceId, storageKey,
	})), fixture.managedSources);
	assert.equal(soundHost.readCatalog().media.length, 2);
	await resources.disposeController(soundscaper);
	await resources.closeStore(soundStore);
	await resources.disposeService(soundService);
	await resources.closeHost(soundHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	const frameService = resources.trackService(new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 70_000,
		createEntryId: () => { throw new Error('Framescaper must preserve the shared entry'); },
	}));
	const frameProbe = serviceBridge(frameService);
	const frameStore = resources.trackStore(projectStore(
		`fallback-handoff-frame-${Date.now()}-${Math.random()}`,
		frameProbe.bridge,
	));
	assert.equal(await frameStore.getSourceMetadata(fixture.original.storageKey), null);
	assert.equal(await frameStore.getSourceMetadata(fixture.fallback.storageKey), null);
	assert.deepEqual(await frameStore.listProjectRevisions(fixture.project.id), []);
	await frameStore.saveSetting('framescaper:last-project-id', fixture.project.id);
	const engine = createHeadlessEngine();
	const exportProbe = createAudioExportProbe(fixture.fallback.id);
	const framescaper = resources.trackController(createEditorController(null, {
		engine: engine.engine,
		fileService: exportProbe.fileService,
		headless: true,
		productId: 'framescaper',
		renderSnapshot: exportProbe.renderSnapshot,
		store: frameStore,
	}));

	const ready = await framescaper.ready;
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
	assert.deepEqual(framescaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(await readPcm(frameStore, fixture.original.storageKey), ORIGINAL_CHANNELS);
	assert.deepEqual(await readPcm(frameStore, fixture.fallback.storageKey), FALLBACK_CHANNELS);
	assert.deepEqual(
		new Set(frameProbe.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(soundBundle.sources.map(({ bindingId }) => bindingId)),
	);
	const shadow = await frameStore.loadProject(fixture.project.id, { revision: fixture.project.revision });
	assert.equal(
		serializeScapeProjectDocument(shadow),
		serializeScapeProjectDocument(fixture.project),
	);
	const shadowDocument = shadow as unknown as Readonly<{
		featureRequirements: Parameters<typeof normalizeProjectFeatureRequirements>[0];
		sources: readonly never[]; clips: readonly never[]; tracks: readonly never[];
	}>;
	assert.equal(
		normalizeProjectFeatureRequirements(shadowDocument.featureRequirements, {
			sources: shadowDocument.sources, clips: shadowDocument.clips, tracks: shadowDocument.tracks,
		}).requirements[0]?.fallback?.role,
		'project-audio-mix-v1',
		'the delivered legacy manifest must normalize to the exact closed role',
	);

	const playbackProject = engine.project();
	assert.ok(playbackProject);
	assert.deepEqual(playbackProject.tracks.map(({ id }) => id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
	]);
	assert.deepEqual(playbackProject.clips.map(({ id, sourceId }) => ({ id, sourceId })), [{
		id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
		sourceId: fixture.fallback.id,
	}]);
	assert.deepEqual(engine.samplesFor(fixture.fallback.id), FALLBACK_CHANNELS);
	const snapshot = framescaper.getSnapshot() as typeof ready & Readonly<{
		audioRenderedFallback?: Readonly<{
			featureId?: string;
			requirementId?: string;
			sourceId?: string;
		}> | null;
		featureRequirementsCompatibility?: Readonly<{
			items?: readonly Readonly<{ availability?: string }>[];
		}> | null;
	}>;
	assert.equal(snapshot.featureRequirementsCompatibility?.items?.[0]?.availability, 'unknown');
	assert.equal(snapshot.audioRenderedFallback?.sourceId, fixture.fallback.id);
	assert.equal(
		snapshot.audioRenderedFallback?.featureId,
		UNKNOWN_AUDIO_FEATURE_ID,
	);
	assert.equal(snapshot.audioRenderedFallback?.requirementId, 'publisher-audio-render');
	await frameStore.deleteSource(fixture.fallback.storageKey);
	await writePcm(frameStore, fixture.fallback, CORRUPT_FALLBACK_CHANNELS);
	assert.equal(await exportActions(framescaper).start(AUDIO_EXPORT_SETTINGS), undefined);
	assert.equal(exportProbe.renders.length, 0, 'activation-time admission cannot authorize changed PCM');
	assert.equal(exportProbe.downloads.length, 0);
	assert.equal(framescaper.getSnapshot().status.state, 'error');
	assert.match(framescaper.getSnapshot().status.message, /failed SHA-256 verification/u);
	await frameStore.deleteSource(fixture.fallback.storageKey);
	await writePcm(frameStore, fixture.fallback, FALLBACK_CHANNELS);
	assert.deepEqual(await readPcm(frameStore, fixture.fallback.storageKey), FALLBACK_CHANNELS);
	const exported = await exportActions(framescaper).start(AUDIO_EXPORT_SETTINGS);
	assert.ok(exported, JSON.stringify(framescaper.getSnapshot().status));
	assert.match(String(exported.fileName), /^Audio-rendered-fallback-handoff-mix-\d{4}-\d{2}-\d{2}\.wav$/u);
	assert.equal(exported.mimeType, 'audio/wav');
	assert.deepEqual(exportProbe.renders, [FALLBACK_CHANNELS]);
	assert.deepEqual(exportProbe.downloads.map(({ purpose }) => purpose), ['audio']);
	assert.deepEqual(await readWavPcm(exportProbe.downloads[0]!.blob), FALLBACK_CHANNELS);
	assert.equal(
		serializeScapeProjectDocument(framescaper.getSnapshot().project),
		serializeScapeProjectDocument(fixture.project),
		'fallback delivery must not project canonical state',
	);
	const exportedShadow = await frameStore.loadProject(fixture.project.id, { revision: fixture.project.revision });
	assert.equal(serializeScapeProjectDocument(exportedShadow), serializeScapeProjectDocument(fixture.project));

	const transport = framescaper.actions.transport as unknown as TransportActions;
	await transport.playPause();
	assert.equal(engine.state(), 'playing');
});

function fallbackProjectFixture() {
	const original = createAudioSource({
		id: 'fallback-handoff-original', storageKey: 'physical/fallback-handoff-original',
		name: 'Editable original.wav', mimeType: 'audio/wav', frameCount: ORIGINAL_CHANNELS[0].length,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: ORIGINAL_CHANNELS[0].length,
	});
	const fallback = createAudioSource({
		id: 'fallback-handoff-render', storageKey: 'physical/fallback-handoff-render',
		name: 'Rendered fallback.wav', mimeType: 'audio/wav', frameCount: FALLBACK_CHANNELS[0].length,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: FALLBACK_CHANNELS[0].length,
	});
	const clip = createAudioClip({
		id: 'fallback-handoff-original-clip', sourceId: original.id,
		title: 'Editable original', durationFrames: original.frameCount,
		sourceDurationFrames: original.frameCount,
	});
	const fallbackSha256 = digest(canonicalPcmBytes(FALLBACK_CHANNELS));
	const project = createCurrentAudioEditorProject({
		id: 'audio-rendered-fallback-handoff', title: 'Audio rendered fallback handoff', revision: 3,
		now: '2026-08-02T12:00:00.000Z', sampleRate: 48_000, masterChannels: 2,
		sources: [original, fallback], clips: [clip],
		tracks: [createAudioTrack({
			id: 'fallback-handoff-original-track', name: 'Editable effects', clipIds: [clip.id],
			effects: [createEffect('compressor', { id: 'fallback-handoff-compressor' })],
		})],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-audio-render',
			featureId: UNKNOWN_AUDIO_FEATURE_ID,
			displayName: 'Future mixer',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: fallback.id, sha256: fallbackSha256 },
		}] },
	});
	return Object.freeze({
		fallback,
		managedSources: Object.freeze([
			{
				kind: 'audio', sha256: digest(canonicalPcmBytes(ORIGINAL_CHANNELS)),
				sourceId: original.id, storageKey: original.storageKey,
			},
			{ kind: 'audio', sha256: fallbackSha256, sourceId: fallback.id, storageKey: fallback.storageKey },
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
		commitSharedProject: (request) => service.commitSharedProject(request),
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
	return Object.freeze({
		bodyReads,
		bridge: Object.freeze(bridge),
	});
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

async function writePcm(
	store: AudioEditorProjectStore,
	source: ReturnType<typeof createAudioSource>,
	channels: readonly (readonly number[])[],
): Promise<void> {
	const writer = await store.beginSourceWrite(source.storageKey, {
		name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate,
		channelCount: source.channelCount, chunkFrames: source.chunkFrames,
	});
	await writer.write(channels.map((channel) => Float32Array.from(channel)));
	await writer.commit({
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
}

async function readPcm(store: AudioEditorProjectStore, storageKey: string): Promise<number[][]> {
	const channels: number[][] = [];
	for await (const stored of store.readSourceChunks(storageKey)) {
		const chunkChannels = Array.isArray(stored) ? stored : stored.channels;
		for (const [index, channel] of chunkChannels.entries()) {
			channels[index] ??= [];
			channels[index]?.push(...channel);
		}
	}
	return channels;
}

function createHeadlessEngine(): HeadlessEngineProbe {
	const appliedSources = new Map<string, readonly (readonly number[])[]>();
	let appliedProject: AudioEditorProjectCurrent | null = null;
	let state: 'paused' | 'playing' | 'stopped' = 'stopped';
	const capture = (project: unknown, buffers: unknown): void => {
		appliedProject = project as AudioEditorProjectCurrent;
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
		loadProject(project: unknown, buffers: unknown) { capture(project, buffers); },
		async applyProject(project: unknown, buffers: unknown) { capture(project, buffers); },
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
	return Object.freeze({
		engine,
		project: () => appliedProject,
		samplesFor: (sourceId: string) => appliedSources.get(sourceId) ?? null,
		state: () => state,
	});
}

function createAudioExportProbe(fallbackSourceId: string) {
	const downloads: Array<Readonly<{ blob: Blob; purpose?: unknown; suggestedName?: unknown }>> = [];
	const renders: Array<readonly (readonly number[])[]> = [];
	return Object.freeze({
		downloads,
		renders,
		async renderSnapshot(
			project: AudioEditorProjectCurrent,
			_range: unknown,
			buffers: ReadonlyMap<string, unknown>,
			signal: AbortSignal,
			chunkSources: ReadonlyMap<string, EngineChunkSource>,
		) {
			assert.deepEqual(project.tracks.map(({ id }) => id), [PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track]);
			assert.equal(buffers.size, 0);
			assert.deepEqual([...chunkSources.keys()], [fallbackSourceId]);
			const provider = chunkSources.get(fallbackSourceId);
			assert.ok(provider);
			const value = await provider.readStorageChunk(0, { signal });
			const channels = audioChunkChannels(value).map((channel) => channel.slice());
			renders.push(Object.freeze(channels.map((channel) => Object.freeze([...channel]))));
			const buffer = new HeadlessAudioBuffer(channels.length, provider.frameCount, provider.sampleRate);
			for (const [channel, samples] of channels.entries()) {
				buffer.copyToChannel(samples, channel);
			}
			return buffer;
		},
		fileService: Object.freeze({
			isDesktop: false,
			async createDownload(request: Readonly<{
				blob: Blob;
				purpose?: unknown;
				suggestedName?: unknown;
			}>) {
				downloads.push(request);
				return Object.freeze({
					url: null,
					fileName: request.suggestedName,
					method: 'test',
					async cleanup() {},
				});
			},
		}),
	});
}

function audioChunkChannels(value: EngineChunkReadValue): readonly Float32Array[] {
	if (Array.isArray(value)) return value as readonly Float32Array[];
	return (value as Readonly<{ channels: readonly Float32Array[] }>).channels;
}

async function readWavPcm(blob: Blob): Promise<number[][]> {
	const channels: number[][] = [];
	await streamWavBlobPcm(blob, {
		onChunk(chunk: readonly Float32Array[]) {
			for (const [index, channel] of chunk.entries()) {
				channels[index] ??= [];
				channels[index]?.push(...channel);
			}
		},
	});
	return channels;
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

function canonicalPcmBytes(channels: readonly (readonly number[])[]): Uint8Array {
	const frameCount = channels[0]?.length ?? 0;
	const bytes = new Uint8Array(4 + frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, frameCount, true);
	let offset = 4;
	for (const channel of channels) {
		for (const sample of channel) {
			view.setFloat32(offset, sample, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return bytes;
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

function exportActions(controller: EditorController): ExportActions {
	return controller.actions.export as unknown as ExportActions;
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
		if (failures.length) throw new AggregateError(failures, 'Fallback handoff fixture cleanup failed');
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
