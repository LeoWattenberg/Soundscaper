/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import type { ControllerTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';

const DIGEST = 'de'.repeat(32);

test('video delivery applies only the maintained rendered fallback and preserves canonical audio', () => {
	const canonical = combinedFallbackProject();
	const before = structuredClone(canonical);
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: false });

	const delivery = service.projectForVideoRenderedFallbackDelivery(canonical);

	assert.equal(delivery.featureRequirementsReport?.compatible, false);
	assert.equal(delivery.videoRenderedFallback?.sourceId, 'fallback-video');
	assert.deepEqual(delivery.requiredVideoSourceIds, ['fallback-video']);
	assert.equal(Object.isFrozen(delivery), true);
	assert.equal(Object.isFrozen(delivery.requiredVideoSourceIds), true);
	assert.deepEqual(canonical, before, 'the canonical project must remain unchanged');

	assert.deepEqual(delivery.project.tracks.map(({ id }) => id), [
		'canonical-audio-track',
		PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
	]);
	assert.deepEqual(delivery.project.clips.map(({ id }) => id), [
		'canonical-audio-clip',
		PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
	]);
	assert.strictEqual(delivery.project.tracks[0], canonical.tracks[0]);
	assert.strictEqual(delivery.project.clips[0], canonical.clips[0]);
	assert.equal(delivery.project.clips[0]?.sourceId, 'canonical-audio');
	const deliveredAudioEffect = (delivery.project.tracks[0] as ControllerTrack | undefined)?.effects?.[0];
	assert.equal(deliveredAudioEffect?.type, 'compressor');
	assert.equal(deliveredAudioEffect?.bypassed, undefined);
	assert.equal(
		delivery.project.clips.some(({ sourceId }) => sourceId === 'fallback-audio'),
		false,
		'the audio rendered fallback must not be composed into video delivery',
	);
});

test('video delivery leaves available, bypass-only, and third-party requirements unprojected', () => {
	const qualifying = combinedFallbackProject();
	const available = createPlaybackProjectService({ audioEffects: false, videoEffects: true })
		.projectForVideoRenderedFallbackDelivery(qualifying);
	assert.strictEqual(available.project, qualifying);
	assert.equal(available.videoRenderedFallback, null);
	assert.deepEqual(available.requiredVideoSourceIds, []);

	for (const candidate of [
		videoRequirementProject({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
			disposition: 'bypass',
			fallback: null,
		}),
		videoRequirementProject({
			featureId: 'org.example.video-effects',
			disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: 'fallback-video', sha256: DIGEST },
		}),
	]) {
		const delivery = createPlaybackProjectService({ audioEffects: true, videoEffects: false })
			.projectForVideoRenderedFallbackDelivery(candidate);
		assert.strictEqual(delivery.project, candidate);
		assert.equal(delivery.videoRenderedFallback, null);
		assert.deepEqual(delivery.requiredVideoSourceIds, []);
	}
});

test('video delivery does not traverse future project feature or media state', () => {
	const future = {
		schemaVersion: 10,
		get featureRequirements(): never { throw new Error('future feature requirements were traversed'); },
		get sources(): never { throw new Error('future sources were traversed'); },
		get clips(): never { throw new Error('future clips were traversed'); },
		get tracks(): never { throw new Error('future tracks were traversed'); },
	};
	const delivery = createPlaybackProjectService({ audioEffects: false, videoEffects: false })
		.projectForVideoRenderedFallbackDelivery(future);

	assert.strictEqual(delivery.project, future);
	assert.equal(delivery.featureRequirementsReport, null);
	assert.equal(delivery.videoRenderedFallback, null);
	assert.deepEqual(delivery.requiredVideoSourceIds, []);
});

function combinedFallbackProject() {
	const canonicalAudio = createAudioSourceV9({
		id: 'canonical-audio', storageKey: 'canonical-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallbackAudio = createAudioSourceV9({
		id: 'fallback-audio', storageKey: 'fallback-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const canonicalVideo = createVideoSourceV9({
		id: 'canonical-video', storageKey: 'canonical-video', frameCount: 8,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const fallbackVideo = createVideoSourceV9({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 10,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const audioClip = createAudioClipV9({
		id: 'canonical-audio-clip', sourceId: canonicalAudio.id, durationFrames: 8,
	});
	const videoClip = createVideoClipV9({
		id: 'canonical-video-clip', sourceId: canonicalVideo.id, durationFrames: 8,
		videoEffects: [{ id: 'video-effect', type: 'pixelate', enabled: true, params: { blockSize: 12 } }],
	});
	return createAudioEditorProjectV9({
		id: 'combined-fallback-project', now: '2026-08-02T12:00:00.000Z',
		sources: [canonicalAudio, fallbackAudio, canonicalVideo, fallbackVideo],
		clips: [audioClip, videoClip],
		tracks: [
			createAudioTrackV9({
				id: 'canonical-audio-track', clipIds: [audioClip.id],
				effects: [createEffect('compressor', { id: 'audio-effect' })],
			}),
			createVideoTrackV9({ id: 'canonical-video-track', clipIds: [videoClip.id] }),
		],
		featureRequirements: { schemaVersion: 1, requirements: [
			{
				id: 'publisher-audio-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
				displayName: 'Publisher audio render', disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: fallbackAudio.id, sha256: DIGEST },
			},
			{
				id: 'publisher-video-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher video render', disposition: 'rendered-fallback',
				fallback: { kind: 'video', sourceId: fallbackVideo.id, sha256: DIGEST },
			},
		] },
	});
}

function videoRequirementProject(requirement: Readonly<{
	featureId: string;
	disposition: 'bypass' | 'rendered-fallback';
	fallback: null | Readonly<{ kind: 'video'; sourceId: string; sha256: string }>;
}>) {
	const canonical = createVideoSourceV9({
		id: 'canonical-video', storageKey: 'canonical-video', frameCount: 8,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const fallback = createVideoSourceV9({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 8,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const clip = createVideoClipV9({
		id: 'canonical-video-clip', sourceId: canonical.id, durationFrames: 8,
	});
	return createAudioEditorProjectV9({
		id: `video-requirement-${requirement.disposition}`,
		now: '2026-08-02T12:00:00.000Z', sources: [canonical, fallback], clips: [clip],
		tracks: [createVideoTrackV9({ id: 'canonical-video-track', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-video-requirement', featureId: requirement.featureId,
			displayName: 'Publisher video requirement',
			disposition: requirement.disposition, fallback: requirement.fallback,
		}] },
	});
}
