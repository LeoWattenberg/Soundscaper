/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createLabelTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';

const DIGEST = 'ed'.repeat(32);

test('audio delivery applies only the maintained whole-mix fallback and preserves canonical video', () => {
	const canonical = combinedFallbackProject();
	const before = structuredClone(canonical);
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: false });

	const delivery = service.projectForAudioRenderedFallbackDelivery(canonical);

	assert.equal(delivery.featureRequirementsReport?.compatible, false);
	assert.equal(delivery.audioRenderedFallback?.sourceId, 'fallback-audio');
	assert.deepEqual(delivery.requiredAudioSourceIds, ['fallback-audio']);
	assert.equal(Object.isFrozen(delivery), true);
	assert.equal(Object.isFrozen(delivery.requiredAudioSourceIds), true);
	assert.deepEqual(canonical, before, 'the canonical project must remain unchanged');

	assert.deepEqual(delivery.project.tracks.map(({ id }) => id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		'canonical-video-track',
		'labels',
	]);
	assert.deepEqual(delivery.project.clips.map(({ id }) => id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
		'canonical-video-clip',
	]);
	assert.strictEqual(delivery.project.tracks[1], canonical.tracks[1]);
	assert.strictEqual(delivery.project.tracks[2], canonical.tracks[2]);
	assert.strictEqual(delivery.project.clips[1], canonical.clips[1]);
	const deliveredVideoClip = delivery.project.clips[1] as Readonly<{
		sourceId: string;
		videoEffects: readonly Readonly<{ enabled: boolean }>[];
	}>;
	assert.equal(deliveredVideoClip.sourceId, 'canonical-video');
	assert.equal(deliveredVideoClip.videoEffects[0]?.enabled, true);
	assert.equal(
		delivery.project.clips.some(({ sourceId }) => sourceId === 'fallback-video'),
		false,
		'the video rendered fallback must not be composed into audio delivery',
	);
	assert.equal('videoRenderedFallback' in delivery, false);
	assert.equal('videoEffectPlaybackBypass' in delivery, false);
});

test('audio delivery leaves available, bypass-only, and third-party requirements unprojected', () => {
	const qualifying = combinedFallbackProject();
	const available = createPlaybackProjectService({ audioEffects: true, videoEffects: false })
		.projectForAudioRenderedFallbackDelivery(qualifying);
	assert.strictEqual(available.project, qualifying);
	assert.equal(available.audioRenderedFallback, null);
	assert.deepEqual(available.requiredAudioSourceIds, []);

	for (const candidate of [
		audioRequirementProject({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			disposition: 'bypass',
			fallback: null,
		}),
		audioRequirementProject({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: 'fallback-audio', sha256: DIGEST },
		}),
		audioRequirementProject({
			featureId: 'org.example.audio-effects',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: 'fallback-audio', sha256: DIGEST },
		}),
	]) {
		const delivery = createPlaybackProjectService({ audioEffects: false, videoEffects: true })
			.projectForAudioRenderedFallbackDelivery(candidate);
		assert.strictEqual(delivery.project, candidate);
		assert.equal(delivery.audioRenderedFallback, null);
		assert.deepEqual(delivery.requiredAudioSourceIds, []);
	}
});

test('audio delivery identifies the actual registered unavailable feature', () => {
	const canonical = audioRequirementProject({
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'fallback-audio', sha256: DIGEST },
	});
	const delivery = createPlaybackProjectService({ audioSpectralEditing: false, videoEffects: true })
		.projectForAudioRenderedFallbackDelivery(canonical);

	assert.equal(delivery.audioRenderedFallback?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing);
	assert.equal(delivery.audioRenderedFallback?.requirementId, 'publisher-audio-requirement');
	assert.deepEqual(delivery.requiredAudioSourceIds, ['fallback-audio']);
	assert.equal(delivery.project.clips[0]?.sourceId, 'fallback-audio');
});

test('audio delivery does not traverse future project feature or media state', () => {
	const future = {
		schemaVersion: 10,
		get featureRequirements(): never { throw new Error('future feature requirements were traversed'); },
		get sources(): never { throw new Error('future sources were traversed'); },
		get clips(): never { throw new Error('future clips were traversed'); },
		get tracks(): never { throw new Error('future tracks were traversed'); },
	};
	const delivery = createPlaybackProjectService({ audioEffects: false, videoEffects: false })
		.projectForAudioRenderedFallbackDelivery(future);

	assert.strictEqual(delivery.project, future);
	assert.equal(delivery.featureRequirementsReport, null);
	assert.equal(delivery.audioRenderedFallback, null);
	assert.deepEqual(delivery.requiredAudioSourceIds, []);
});

function combinedFallbackProject() {
	const canonicalAudio = createAudioSourceV9({
		id: 'canonical-audio', storageKey: 'canonical-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallbackAudio = createAudioSourceV9({
		id: 'fallback-audio', storageKey: 'fallback-audio', frameCount: 12,
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
			createLabelTrackV9({ id: 'labels', labels: [] }),
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
			{
				id: 'publisher-video-bypass', featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher video bypass', disposition: 'bypass', fallback: null,
			},
		] },
	});
}

function audioRequirementProject(requirement: Readonly<{
	featureId: string;
	disposition: 'bypass' | 'rendered-fallback';
	fallback: null | Readonly<{ kind: 'audio'; sourceId: string; sha256: string }>;
}>) {
	const canonical = createAudioSourceV9({
		id: 'canonical-audio', storageKey: 'canonical-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSourceV9({
		id: 'fallback-audio', storageKey: 'fallback-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClipV9({
		id: 'canonical-audio-clip', sourceId: canonical.id, durationFrames: 8,
	});
	return createAudioEditorProjectV9({
		id: `audio-requirement-${requirement.disposition}`,
		now: '2026-08-02T12:00:00.000Z', sources: [canonical, fallback], clips: [clip],
		tracks: [createAudioTrackV9({ id: 'canonical-audio-track', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-audio-requirement', featureId: requirement.featureId,
			displayName: 'Publisher audio requirement',
			disposition: requirement.disposition, fallback: requirement.fallback,
		}] },
	});
}
