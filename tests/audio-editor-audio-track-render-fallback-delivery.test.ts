/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	admitAudioRenderedFallbackExport,
	assertAudioRenderedFallbackDeliveryProjection,
	assertAudioRenderedFallbackExportSettings,
	audioRenderedFallbackIntegritySelector,
	audioRenderedFallbackRenderSources,
} from '../src/common/editor/controller/audio-rendered-fallback-export.ts';
import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS } from '../src/common/editor/project-feature-audio-track-render-v1.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	verifyProjectFallbackIntegrity,
	type ProjectAudioFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const AUDIO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
const FALLBACK_SOURCE_ID = 'fallback-track-render';
const FALLBACK_CHUNKS = Object.freeze([
	trackChunk(0, [Float32Array.of(0.25, -0.5), Float32Array.of(0.75, -1)]),
	trackChunk(1, [Float32Array.of(0.125), Float32Array.of(-0.25)]),
]);
const FALLBACK_DIGEST = trackAudioDigest(FALLBACK_CHUNKS);
const TRACK_SELECTOR: ProjectAudioFallbackIntegritySelector = Object.freeze({
	requirementId: 'publisher-track-render',
	featureId: AUDIO_EFFECTS,
	kind: 'audio',
	sourceId: FALLBACK_SOURCE_ID,
	sha256: FALLBACK_DIGEST,
	role: 'audio-track-render-v1',
	targetTrackId: 'fx-track',
});

function trackFallbackProject(): AudioEditorProjectCurrent {
	const laneSource = createAudioSourceV9({
		id: 'lane-source', storageKey: 'lane-source', frameCount: 3, channelCount: 2, chunkFrames: 2,
	});
	const drySource = createAudioSourceV9({
		id: 'dry-source', storageKey: 'dry-source', frameCount: 3, channelCount: 2, chunkFrames: 2,
	});
	const fallbackSource = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: 3, channelCount: 2, chunkFrames: 2,
	});
	const laneClip = createAudioClipV9({
		id: 'lane-clip', sourceId: laneSource.id, timelineStartFrame: 0, durationFrames: 3,
	});
	const dryClip = createAudioClipV9({
		id: 'dry-clip', sourceId: drySource.id, timelineStartFrame: 0, durationFrames: 3,
	});
	return createCurrentAudioEditorProject({
		id: 'track-fallback-delivery', now: '2026-08-08T12:00:00.000Z', sampleRate: 48_000,
		sources: [laneSource, drySource, fallbackSource],
		clips: [laneClip, dryClip],
		tracks: [
			createAudioTrackV9({
				id: 'fx-track', name: 'Saturated lane', clipIds: [laneClip.id],
				effects: [{ id: 'foreign-fx', type: 'com.example.saturator', enabled: true, params: {} }],
			}),
			createAudioTrackV9({ id: 'dry-track', name: 'Dry lane', clipIds: [dryClip.id] }),
		],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-track-render',
				featureId: AUDIO_EFFECTS,
				displayName: 'Publisher track render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'audio-track-render-v1', kind: 'audio', sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST, targetTrackId: 'fx-track',
				},
			}],
		},
	});
}

test('track-render delivery projects only the target lane and builds its exact selector', () => {
	const canonical = trackFallbackProject();
	const playback = createPlaybackProjectService({ audioEffects: false });
	const delivery = playback.projectForAudioRenderedFallbackDelivery(canonical);

	assert.deepEqual(delivery.audioRenderedFallback, {
		schemaVersion: 1,
		role: 'audio-track-render-v1',
		featureId: AUDIO_EFFECTS,
		requirementId: 'publisher-track-render',
		sourceId: FALLBACK_SOURCE_ID,
		targetTrackId: 'fx-track',
		clipId: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip,
	});
	assert.deepEqual(delivery.requiredAudioSourceIds, [FALLBACK_SOURCE_ID]);
	assert.deepEqual(delivery.project.tracks[0]?.clipIds, [PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip]);
	assert.strictEqual(delivery.project.tracks[1], canonical.tracks[1], 'the dry lane must stay canonical');
	assertAudioRenderedFallbackDeliveryProjection(delivery);
	assert.deepEqual(audioRenderedFallbackIntegritySelector(delivery), TRACK_SELECTOR);

	assertAudioRenderedFallbackExportSettings(delivery, { mode: 'mix', format: 'wav' });
	for (const [settings, message] of [
		[{ mode: 'stems', format: 'wav' }, /only normalized mix mode/iu],
		[{ mode: 'mix', format: 'bw64' }, /BW64 or ADM/iu],
		[{ mode: 'mix', format: 'wav', adm: {} }, /BW64 or ADM/iu],
	] as const) {
		assert.throws(() => assertAudioRenderedFallbackExportSettings(delivery, settings), message);
	}
});

test('track-render delivery metadata is validated as a track relationship', () => {
	const canonical = trackFallbackProject();
	const playback = createPlaybackProjectService({ audioEffects: false });
	const delivery = playback.projectForAudioRenderedFallbackDelivery(canonical);
	for (const [changes, message] of [
		[{ clipId: 'wrong-clip' }, /invalid track relationship/iu],
		[{ targetTrackId: '' }, /invalid track relationship/iu],
		[{ featureId: 'org.example.other-feature' }, /invalid track relationship/iu],
	] as const) {
		assert.throws(
			() => assertAudioRenderedFallbackDeliveryProjection({
				...delivery,
				audioRenderedFallback: {
					...delivery.audioRenderedFallback!, ...changes,
				} as unknown as typeof delivery.audioRenderedFallback,
			}),
			message,
		);
	}
});

test('render sources stay private for the whole mix and merge for the track role', () => {
	const verified = trackProvider('verified');
	const ordinaryFallbackProvider = trackProvider('ordinary');
	const dryProvider = trackProvider('dry');
	const laneBuffer = Object.freeze({ owner: 'lane-buffer' });
	const staleFallbackBuffer = Object.freeze({ owner: 'stale-fallback-buffer' });
	const runtime = Object.freeze({
		sourceBuffers: new Map<string, unknown>([
			['lane-source', laneBuffer],
			[FALLBACK_SOURCE_ID, staleFallbackBuffer],
		]),
		sourceChunkProviders: new Map<string, unknown>([
			['dry-source', dryProvider],
			[FALLBACK_SOURCE_ID, ordinaryFallbackProvider],
		]),
	});

	const mix = audioRenderedFallbackRenderSources(Object.freeze({
		schemaVersion: 1 as const,
		role: 'project-audio-mix-v1' as const,
		featureId: 'org.example.future-mixer',
		requirementId: 'publisher-mix-render',
		sourceId: FALLBACK_SOURCE_ID,
		trackId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		clipId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
	}), verified, runtime);
	assert.equal(mix.sourceMap.size, 0, 'the whole mix must not see global buffers');
	assert.deepEqual([...mix.chunkSources.entries()], [[FALLBACK_SOURCE_ID, verified]]);
	assert.equal(mix.prepareTimePitchCaches, false);

	const track = audioRenderedFallbackRenderSources(Object.freeze({
		schemaVersion: 1 as const,
		role: 'audio-track-render-v1' as const,
		featureId: AUDIO_EFFECTS,
		requirementId: 'publisher-track-render',
		sourceId: FALLBACK_SOURCE_ID,
		targetTrackId: 'fx-track',
		clipId: PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip,
	}), verified, runtime);
	assert.deepEqual([...track.sourceMap.entries()], [['lane-source', laneBuffer]],
		'the fallback body must not be readable through a cached buffer');
	assert.deepEqual([...track.chunkSources.entries()], [
		['dry-source', dryProvider],
		[FALLBACK_SOURCE_ID, verified],
	], 'the verified provider must replace any ordinary provider for the fallback source');
	assert.equal(track.prepareTimePitchCaches, true, 'native lanes keep their time-pitch caches');
});

test('track-render export admission passes the track selector through operation-time verification', async () => {
	const canonical = trackFallbackProject();
	const playback = createPlaybackProjectService({ audioEffects: false });
	const delivery = playback.projectForAudioRenderedFallbackDelivery(canonical);
	const provider = trackProvider('verified');
	const events: string[] = [];
	const store = Object.freeze({ owner: 'store' });
	const admitted = await admitAudioRenderedFallbackExport(canonical, delivery, {
		store,
		verifyProjectFallbackIntegrity(project, candidateStore, options) {
			events.push('verify');
			assert.strictEqual(project, canonical);
			assert.strictEqual(candidateStore, store);
			assert.deepEqual(options.audioFallback, TRACK_SELECTOR);
			return Object.freeze({
				assertCurrent(candidate: unknown) {
					events.push('current');
					assert.strictEqual(candidate, canonical);
				},
				getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector) {
					events.push('provider');
					assert.deepEqual(selector, TRACK_SELECTOR);
					return provider;
				},
			});
		},
	}, { assertCurrent: () => undefined });

	assert.strictEqual(admitted, provider);
	assert.deepEqual(events, ['verify', 'current', 'provider']);
});

test('operation-time integrity verifies the track claim and refuses target drift', async () => {
	const canonical = trackFallbackProject();
	let scans = 0;
	const store = {
		async *readSourceChunks(sourceId: string, options?: Readonly<{ migrateLegacyPcmOnAccess?: boolean }>) {
			assert.equal(sourceId, FALLBACK_SOURCE_ID);
			assert.equal(options?.migrateLegacyPcmOnAccess, false);
			scans += 1;
			for (const value of FALLBACK_CHUNKS) yield cloneTrackChunk(value);
		},
		readSourceChunk(_sourceId: string, chunkIndex: number) {
			return cloneTrackChunk(FALLBACK_CHUNKS[chunkIndex]!);
		},
	};
	const admission = await verifyProjectFallbackIntegrity(canonical, store, { audioFallback: TRACK_SELECTOR });
	assert.equal(scans, 1);
	const provider = admission.getVerifiedAudioChunkProvider(TRACK_SELECTOR);
	const chunkChannels = await provider.readStorageChunk(0);
	assert.deepEqual([...chunkChannels[0]!], [0.25, -0.5]);

	await assert.rejects(
		() => verifyProjectFallbackIntegrity(canonical, store, {
			audioFallback: { ...TRACK_SELECTOR, targetTrackId: 'dry-track' } as ProjectAudioFallbackIntegritySelector,
		}),
		/selected audio rendered fallback/iu,
	);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(canonical, store, {
			audioFallback: {
				...TRACK_SELECTOR, role: 'project-audio-mix-v1', targetTrackId: null,
			} as ProjectAudioFallbackIntegritySelector,
		}),
		/selected audio rendered fallback/iu,
	);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(canonical, store, {
			audioFallback: {
				...TRACK_SELECTOR, targetTrackId: null,
			} as unknown as ProjectAudioFallbackIntegritySelector,
		}),
		/selected audio rendered fallback is invalid/iu,
	);
});

test('the default claims scan verifies the track-role body without a selector', async () => {
	const canonical = trackFallbackProject();
	let scans = 0;
	const admission = await verifyProjectFallbackIntegrity(canonical, {
		async *readSourceChunks(sourceId: string) {
			assert.equal(sourceId, FALLBACK_SOURCE_ID);
			scans += 1;
			for (const value of FALLBACK_CHUNKS) yield cloneTrackChunk(value);
		},
	});
	assert.equal(scans, 1);
	assert.throws(
		() => admission.getVerifiedAudioChunkProvider(TRACK_SELECTOR),
		/no selected audio rendered fallback/iu,
	);
});

function trackChunk(index: number, channels: readonly Float32Array[]): Readonly<{
	index: number;
	frames: number;
	channels: readonly Float32Array[];
}> {
	return Object.freeze({ index, frames: channels[0]?.length ?? 0, channels: Object.freeze([...channels]) });
}

function cloneTrackChunk(value: Readonly<{ index: number; frames: number; channels: readonly Float32Array[] }>) {
	return {
		index: value.index,
		frames: value.frames,
		channels: value.channels.map((channel) => new Float32Array(channel)),
	};
}

function trackAudioDigest(
	chunks: readonly Readonly<{ frames: number; channels: readonly Float32Array[] }>[],
): string {
	const digest = createHash('sha256');
	for (const value of chunks) {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(value.frames, 0);
		digest.update(header);
		for (const channel of value.channels) {
			digest.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
		}
	}
	return digest.digest('hex');
}

function trackProvider(owner: string): EngineChunkSource {
	return Object.freeze({
		channelCount: 2,
		frameCount: 3,
		chunkFrames: 2,
		sampleRate: 48_000,
		async readStorageChunk() {
			return Object.freeze([Float32Array.of(owner.length), Float32Array.of(-owner.length)]);
		},
	});
}
