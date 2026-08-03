/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
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

test('video delivery composes the maintained audio and video rendered fallbacks', () => {
	const canonical = combinedFallbackProject();
	const before = structuredClone(canonical);
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: false });

	const delivery = service.projectForVideoRenderedFallbackDelivery(canonical);

	assert.equal(delivery.featureRequirementsReport?.compatible, false);
	assert.equal(delivery.audioRenderedFallback?.sourceId, 'fallback-audio');
	assert.equal(delivery.videoRenderedFallback?.sourceId, 'fallback-video');
	assert.deepEqual(delivery.requiredAudioSourceIds, ['fallback-audio']);
	assert.deepEqual(delivery.requiredVideoSourceIds, ['fallback-video']);
	assert.equal(Object.isFrozen(delivery), true);
	assert.equal(Object.isFrozen(delivery.requiredAudioSourceIds), true);
	assert.equal(Object.isFrozen(delivery.requiredVideoSourceIds), true);
	assert.deepEqual(canonical, before, 'the canonical project must remain unchanged');

	assert.deepEqual(delivery.project.tracks.map(({ id }) => id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
	]);
	assert.deepEqual(delivery.project.clips.map(({ id }) => id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
		PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
	]);
	assert.deepEqual(delivery.project.clips.map(({ sourceId }) => sourceId), [
		'fallback-audio',
		'fallback-video',
	]);
});

test('video delivery supports audio-only and no-fallback projections', () => {
	const qualifying = combinedFallbackProject();
	const audioOnly = createPlaybackProjectService({ audioEffects: false, videoEffects: true })
		.projectForVideoRenderedFallbackDelivery(qualifying);
	assert.equal(audioOnly.audioRenderedFallback?.sourceId, 'fallback-audio');
	assert.equal(audioOnly.videoRenderedFallback, null);
	assert.deepEqual(audioOnly.requiredAudioSourceIds, ['fallback-audio']);
	assert.deepEqual(audioOnly.requiredVideoSourceIds, []);
	assert.deepEqual(audioOnly.project.clips.map(({ sourceId }) => sourceId), [
		'fallback-audio',
		'canonical-video',
	]);

	const none = createPlaybackProjectService({ audioEffects: true, videoEffects: true })
		.projectForVideoRenderedFallbackDelivery(qualifying);
	assert.strictEqual(none.project, qualifying);
	assert.equal(none.audioRenderedFallback, null);
	assert.equal(none.videoRenderedFallback, null);
	assert.deepEqual(none.requiredAudioSourceIds, []);
	assert.deepEqual(none.requiredVideoSourceIds, []);

	for (const candidate of [
		videoRequirementProject({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
			disposition: 'bypass',
			fallback: null,
		}),
	]) {
		const delivery = createPlaybackProjectService({ audioEffects: true, videoEffects: false })
			.projectForVideoRenderedFallbackDelivery(candidate);
		assert.strictEqual(delivery.project, candidate);
		assert.equal(delivery.audioRenderedFallback, null);
		assert.equal(delivery.videoRenderedFallback, null);
		assert.deepEqual(delivery.requiredAudioSourceIds, []);
		assert.deepEqual(delivery.requiredVideoSourceIds, []);
	}
});

test('video delivery projects the closed whole-project role across feature identities', () => {
	for (const [featureId, availability] of [
		[PROJECT_FEATURE_CAPABILITY_IDS.audioAnalysis, 'unavailable'],
		['org.example.future-video-pipeline', 'unknown'],
	] as const) {
		const canonical = videoRequirementProject({
			featureId,
			disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: 'fallback-video', sha256: DIGEST },
		});
		const delivery = createPlaybackProjectService({ audioAnalysis: false })
			.projectForVideoRenderedFallbackDelivery(canonical);

		assert.equal(delivery.featureRequirementsReport?.items[0]?.availability, availability);
		assert.equal(delivery.audioRenderedFallback, null);
		assert.equal(delivery.videoRenderedFallback?.role, 'project-video-render-v1');
		assert.equal(delivery.videoRenderedFallback?.featureId, featureId);
		assert.deepEqual(delivery.requiredAudioSourceIds, []);
		assert.deepEqual(delivery.requiredVideoSourceIds, ['fallback-video']);
		assert.equal(delivery.project.clips[0]?.sourceId, 'fallback-video');
	}
});

test('video delivery rejects duplicate rendered fallbacks of either media kind', () => {
	const canonical = combinedFallbackProject();
	const requirements = canonical.featureRequirements.requirements;
	for (const index of [0, 1] as const) {
		const original = requirements[index]!;
		const ambiguous = {
			...canonical,
			featureRequirements: {
				...canonical.featureRequirements,
				requirements: [...requirements, { ...original, id: `duplicate-${original.id}` }],
			},
		};
		assert.throws(
			() => createPlaybackProjectService({ audioEffects: false, videoEffects: false })
				.projectForVideoRenderedFallbackDelivery(ambiguous),
			/Multiple (?:audio whole-mix|video) rendered fallbacks are ambiguous/u,
		);
	}
});

test('video delivery identifies the actual registered unavailable feature', () => {
	const canonical = videoRequirementProject({
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
		disposition: 'rendered-fallback',
		fallback: { kind: 'video', sourceId: 'fallback-video', sha256: DIGEST },
	});
	const delivery = createPlaybackProjectService({ videoCompositing: false, audioEffects: true })
		.projectForVideoRenderedFallbackDelivery(canonical);

	assert.equal(delivery.videoRenderedFallback?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing);
	assert.equal(delivery.videoRenderedFallback?.requirementId, 'publisher-video-requirement');
	assert.deepEqual(delivery.requiredVideoSourceIds, ['fallback-video']);
	assert.equal(delivery.project.clips[0]?.sourceId, 'fallback-video');
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
	assert.equal(delivery.audioRenderedFallback, null);
	assert.equal(delivery.videoRenderedFallback, null);
	assert.deepEqual(delivery.requiredAudioSourceIds, []);
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
			createAudioTrackV9({ id: 'canonical-audio-track', clipIds: [audioClip.id] }),
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
