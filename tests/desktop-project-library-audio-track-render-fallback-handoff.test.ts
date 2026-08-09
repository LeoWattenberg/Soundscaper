/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10, type AudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import { createEffect } from '../src/common/editor/effects.js';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import { PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS } from '../src/common/editor/project-feature-audio-track-render-v1.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import {
	HeadlessAudioBuffer,
	audioChunkChannels,
	canonicalPcmBytes,
	createDownloadFileService,
	createHeadlessEngine,
	digest,
	exportActions,
	owner,
	projectActions,
	projectStore,
	readPcm,
	readWavPcm,
	serviceBridge,
	trackResources,
	writePcm,
	type TransportActions,
} from './helpers/desktop-project-library-fallback-handoff-fixture.ts';

const TARGET_CHANNELS = Object.freeze([
	Object.freeze([0.125, -0.25, 0.5, -1]),
	Object.freeze([-0.125, 0.25, -0.5, 1]),
]);
const NATIVE_CHANNELS = Object.freeze([
	Object.freeze([0.125, 0.0625, 0.03125, 0, -0.0625, -0.125]),
	Object.freeze([-0.125, -0.0625, -0.03125, 0, 0.0625, 0.125]),
]);
const RENDER_CHANNELS = Object.freeze([
	Object.freeze([0.75, 0.5, 0.25, 0, -0.25, -0.5]),
	Object.freeze([-0.75, -0.5, -0.25, 0, 0.25, 0.5]),
]);
const CORRUPT_RENDER_CHANNELS = Object.freeze([
	Object.freeze([0.75, 0.5, 0.25, 0, -0.25, -0.25]),
	Object.freeze([-0.75, -0.5, -0.25, 0, 0.25, 0.25]),
]);
const MIXED_CHANNELS = Object.freeze(RENDER_CHANNELS.map((channel, index) => Object.freeze(
	channel.map((sample, frame) => sample + (NATIVE_CHANNELS[index]?.[frame] ?? 0)),
)));
const AUDIO_EXPORT_SETTINGS = Object.freeze({
	bitDepth: 32, dither: 'none', format: 'wav', includeTail: false,
	mode: 'mix', sampleFormat: 'float32',
});
const TARGET_TRACK_ID = 'track-handoff-effects-track';
const NATIVE_TRACK_ID = 'track-handoff-native-track';
const NATIVE_CLIP_ID = 'track-handoff-native-clip';
const SOUND_OWNER = owner('soundscaper', 603, 'track-render-handoff-sound');
const FRAME_OWNER = owner('framescaper', 604, 'track-render-handoff-frame');

test('fresh Framescaper acquires, plays, and delivers a track render fallback', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-track-render-handoff-'));
	const resources = trackResources(context, appDataPath);
	const fixture = fallbackProjectFixture();

	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundService = resources.trackService(new DesktopSharedProjectLibraryService(soundHost, {
		now: () => 60_000,
		createEntryId: () => 'track-render-handoff-entry-0001',
	}));
	const soundStore = resources.trackStore(projectStore(
		`track-render-handoff-sound-${Date.now()}-${Math.random()}`,
		serviceBridge(soundService).bridge,
	));
	await writePcm(soundStore, fixture.target, TARGET_CHANNELS);
	await writePcm(soundStore, fixture.native, NATIVE_CHANNELS);
	await writePcm(soundStore, fixture.render, RENDER_CHANNELS);
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
	assert.equal(soundReady.readOnly, false, 'the publisher keeps the target rack natively editable');
	const soundSnapshot = soundscaper.getSnapshot() as Readonly<{
		audioRenderedFallback?: unknown;
		featureRequirementsCompatibility?: Readonly<{
			items?: readonly Readonly<{ availability?: string }>[];
		}> | null;
	}>;
	assert.equal(soundSnapshot.featureRequirementsCompatibility?.items?.[0]?.availability, 'available');
	assert.equal(soundSnapshot.audioRenderedFallback ?? null, null, 'an available rack never projects the render');
	assert.deepEqual(await projectActions(soundscaper).prepareHandoff(), {
		projectId: fixture.project.id,
		revision: fixture.project.revision,
	});
	const soundBundle = await soundService.readSharedProjectBundle(fixture.project.id);
	assert.ok(soundBundle);
	assert.deepEqual(
		sortBySourceId(soundBundle.sources.map(({ kind, sha256, sourceId, storageKey }) => ({
			kind, sha256, sourceId, storageKey,
		}))),
		sortBySourceId(fixture.managedSources),
	);
	assert.equal(soundHost.readCatalog().media.length, 3);
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
		`track-render-handoff-frame-${Date.now()}-${Math.random()}`,
		frameProbe.bridge,
	));
	for (const source of [fixture.target, fixture.native, fixture.render]) {
		assert.equal(await frameStore.getSourceMetadata(source.storageKey), null);
	}
	assert.deepEqual(await frameStore.listProjectRevisions(fixture.project.id), []);
	await frameStore.saveSetting('framescaper:last-project-id', fixture.project.id);
	const engine = createHeadlessEngine();
	const exportProbe = createAudioExportProbe(fixture);
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
			.some(({ sourceId }) => sourceId === fixture.render.id),
		false,
		'the render source must be reachable only from its feature requirement',
	);
	assert.deepEqual(framescaper.getSnapshot().missingSourceIds, []);
	assert.deepEqual(await readPcm(frameStore, fixture.target.storageKey), TARGET_CHANNELS);
	assert.deepEqual(await readPcm(frameStore, fixture.native.storageKey), NATIVE_CHANNELS);
	assert.deepEqual(await readPcm(frameStore, fixture.render.storageKey), RENDER_CHANNELS);
	assert.deepEqual(
		new Set(frameProbe.bodyReads.map(({ bindingId }) => bindingId)),
		new Set(soundBundle.sources.map(({ bindingId }) => bindingId)),
	);
	const shadow = await frameStore.loadProject(fixture.project.id, { revision: fixture.project.revision });
	assert.equal(
		serializeScapeProjectDocument(shadow),
		serializeScapeProjectDocument(fixture.project),
	);

	const playbackProject = engine.project();
	assert.ok(playbackProject);
	assert.deepEqual(playbackProject.tracks.map(({ id }) => id), [TARGET_TRACK_ID, NATIVE_TRACK_ID]);
	const [projectedTarget, projectedNative] = playbackProject.tracks;
	assert.deepEqual(projectedTarget?.clipIds, [PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip]);
	assert.equal(projectedTarget?.effectsActive, false);
	assert.deepEqual(projectedTarget?.effects, []);
	assert.deepEqual(projectedNative?.clipIds, [NATIVE_CLIP_ID]);
	assert.deepEqual(projectedNative?.effects, fixture.project.tracks[1]?.effects);
	assert.deepEqual(playbackProject.clips.map(({ id, sourceId }) => ({ id, sourceId })), [
		{ id: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip, sourceId: fixture.render.id },
		{ id: NATIVE_CLIP_ID, sourceId: fixture.native.id },
	]);
	const projectedClip = playbackProject.clips[0];
	assert.equal(projectedClip?.timelineStartFrame, 0);
	assert.equal(projectedClip?.durationFrames, fixture.render.frameCount);
	assert.deepEqual(engine.samplesFor(fixture.render.id), RENDER_CHANNELS);
	assert.deepEqual(engine.samplesFor(fixture.native.id), NATIVE_CHANNELS);
	const snapshot = framescaper.getSnapshot() as Readonly<{
		audioRenderedFallback?: Readonly<{
			featureId?: string;
			requirementId?: string;
			role?: string;
			sourceId?: string;
			targetTrackId?: string;
		}> | null;
		featureRequirementsCompatibility?: Readonly<{
			items?: readonly Readonly<{ availability?: string }>[];
		}> | null;
	}>;
	assert.equal(snapshot.featureRequirementsCompatibility?.items?.[0]?.availability, 'unavailable');
	assert.equal(snapshot.audioRenderedFallback?.role, 'audio-track-render-v1');
	assert.equal(snapshot.audioRenderedFallback?.sourceId, fixture.render.id);
	assert.equal(snapshot.audioRenderedFallback?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.audioEffects);
	assert.equal(snapshot.audioRenderedFallback?.requirementId, 'publisher-track-render');
	assert.equal(snapshot.audioRenderedFallback?.targetTrackId, TARGET_TRACK_ID);
	await frameStore.deleteSource(fixture.render.storageKey);
	await writePcm(frameStore, fixture.render, CORRUPT_RENDER_CHANNELS);
	assert.equal(await exportActions(framescaper).start(AUDIO_EXPORT_SETTINGS), undefined);
	assert.equal(exportProbe.renders.length, 0, 'delivery admission cannot authorize changed PCM');
	assert.equal(exportProbe.downloads.length, 0);
	assert.equal(framescaper.getSnapshot().status.state, 'error');
	assert.match(framescaper.getSnapshot().status.message, /failed SHA-256 verification/u);
	await frameStore.deleteSource(fixture.render.storageKey);
	await writePcm(frameStore, fixture.render, RENDER_CHANNELS);
	assert.deepEqual(await readPcm(frameStore, fixture.render.storageKey), RENDER_CHANNELS);
	const exported = await exportActions(framescaper).start(AUDIO_EXPORT_SETTINGS);
	assert.ok(exported, JSON.stringify(framescaper.getSnapshot().status));
	assert.match(String(exported.fileName), /^Track-render-fallback-handoff-mix-\d{4}-\d{2}-\d{2}\.wav$/u);
	assert.equal(exported.mimeType, 'audio/wav');
	assert.deepEqual(exportProbe.renders, [MIXED_CHANNELS]);
	assert.deepEqual(exportProbe.downloads.map(({ purpose }) => purpose), ['audio']);
	assert.deepEqual(await readWavPcm(exportProbe.downloads[0]!.blob), MIXED_CHANNELS);
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
	const target = createAudioSourceV9({
		id: 'track-handoff-target', storageKey: 'physical/track-handoff-target',
		name: 'Effected lane.wav', mimeType: 'audio/wav', frameCount: TARGET_CHANNELS[0].length,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: TARGET_CHANNELS[0].length,
	});
	const native = createAudioSourceV9({
		id: 'track-handoff-native', storageKey: 'physical/track-handoff-native',
		name: 'Native lane.wav', mimeType: 'audio/wav', frameCount: NATIVE_CHANNELS[0].length,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: NATIVE_CHANNELS[0].length,
	});
	const render = createAudioSourceV9({
		id: 'track-handoff-render', storageKey: 'physical/track-handoff-render',
		name: 'Track render.wav', mimeType: 'audio/wav', frameCount: RENDER_CHANNELS[0].length,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: RENDER_CHANNELS[0].length,
	});
	const targetClip = createAudioClipV9({
		id: 'track-handoff-target-clip', sourceId: target.id,
		title: 'Effected lane', timelineStartFrame: 2, durationFrames: target.frameCount,
		sourceDurationFrames: target.frameCount,
	});
	const nativeClip = createAudioClipV9({
		id: NATIVE_CLIP_ID, sourceId: native.id,
		title: 'Native lane', durationFrames: native.frameCount,
		sourceDurationFrames: native.frameCount,
	});
	const renderSha256 = digest(canonicalPcmBytes(RENDER_CHANNELS));
	const project = createAudioEditorProjectV10({
		id: 'audio-track-render-fallback-handoff', title: 'Track render fallback handoff', revision: 3,
		now: '2026-08-03T12:00:00.000Z', sampleRate: 48_000, masterChannels: 2,
		sources: [target, native, render], clips: [targetClip, nativeClip],
		tracks: [
			createAudioTrackV9({
				id: TARGET_TRACK_ID, name: 'Effected lane', clipIds: [targetClip.id],
				effects: [createEffect('compressor', { id: 'track-handoff-compressor' })],
			}),
			createAudioTrackV9({ id: NATIVE_TRACK_ID, name: 'Native lane', clipIds: [nativeClip.id] }),
		],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-track-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Audio effects',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'audio-track-render-v1', kind: 'audio', sourceId: render.id,
				sha256: renderSha256, targetTrackId: TARGET_TRACK_ID,
			},
		}] },
	});
	return Object.freeze({
		managedSources: Object.freeze([
			{
				kind: 'audio', sha256: digest(canonicalPcmBytes(TARGET_CHANNELS)),
				sourceId: target.id, storageKey: target.storageKey,
			},
			{
				kind: 'audio', sha256: digest(canonicalPcmBytes(NATIVE_CHANNELS)),
				sourceId: native.id, storageKey: native.storageKey,
			},
			{ kind: 'audio', sha256: renderSha256, sourceId: render.id, storageKey: render.storageKey },
		]),
		native,
		project,
		render,
		target,
	});
}

function sortBySourceId<Value extends Readonly<{ sourceId: string }>>(
	values: readonly Value[],
): readonly Value[] {
	return [...values].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function createAudioExportProbe(fixture: Readonly<{
	native: Readonly<{ id: string }>;
	render: Readonly<{ id: string }>;
	target: Readonly<{ id: string }>;
}>) {
	const downloads: Array<Readonly<{ blob: Blob; purpose?: unknown; suggestedName?: unknown }>> = [];
	const renders: Array<readonly (readonly number[])[]> = [];
	return Object.freeze({
		downloads,
		renders,
		async renderSnapshot(
			project: AudioEditorProjectV10,
			_range: unknown,
			buffers: ReadonlyMap<string, unknown>,
			signal: AbortSignal,
			chunkSources: ReadonlyMap<string, EngineChunkSource>,
		) {
			assert.deepEqual(project.tracks.map(({ id }) => id), [TARGET_TRACK_ID, NATIVE_TRACK_ID]);
			assert.deepEqual(project.clips.map(({ id, sourceId }) => ({ id, sourceId })), [
				{ id: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip, sourceId: fixture.render.id },
				{ id: NATIVE_CLIP_ID, sourceId: fixture.native.id },
			]);
			assert.deepEqual(
				[...buffers.keys()].sort(),
				[fixture.native.id, fixture.target.id].sort(),
				'the render must be readable only through the verified provider',
			);
			assert.deepEqual(
				[...chunkSources.keys()].sort(),
				[fixture.native.id, fixture.render.id, fixture.target.id].sort(),
			);
			const provider = chunkSources.get(fixture.render.id);
			assert.ok(provider);
			const value = await provider.readStorageChunk(0, { signal });
			const renderChannels = audioChunkChannels(value);
			const nativeBuffer = buffers.get(fixture.native.id);
			assert.ok(nativeBuffer instanceof HeadlessAudioBuffer, 'the native lane keeps its ordinary source');
			assert.deepEqual(
				Array.from({ length: nativeBuffer.numberOfChannels }, (_, channel) => (
					[...nativeBuffer.getChannelData(channel)]
				)),
				NATIVE_CHANNELS,
			);
			const mixed = renderChannels.map((channel, index) => Float32Array.from(
				channel,
				(sample, frame) => sample + (nativeBuffer.getChannelData(index)[frame] ?? 0),
			));
			renders.push(Object.freeze(mixed.map((channel) => Object.freeze([...channel]))));
			const buffer = new HeadlessAudioBuffer(mixed.length, provider.frameCount, provider.sampleRate);
			for (const [channel, samples] of mixed.entries()) {
				buffer.copyToChannel(samples, channel);
			}
			return buffer;
		},
		fileService: createDownloadFileService(downloads),
	});
}
