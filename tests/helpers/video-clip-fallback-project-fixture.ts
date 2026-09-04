/* SPDX-License-Identifier: AGPL-3.0-only */

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../../src/common/editor/project-current.ts';


import { PROJECT_FEATURE_CAPABILITY_IDS } from '../../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../../src/common/editor/project-media-factory.ts';

/**
 * A project whose video and audio are both served by rendered fallbacks.
 *
 * The interesting case is a clip-local video fallback beside a whole-mix audio one: the
 * export has to read the rendered video for the affected clip while the untouched clip
 * still comes from its canonical source, and read the rendered audio for the whole
 * programme. Building that project once, here, keeps the geometry the assertions depend on
 * — where the target starts, where the transition begins, where the programme ends — in a
 * single place the suites agree on.
 */

export const SAMPLE_RATE = 48_000;
export const TARGET_START = 24_000;
export const TARGET_DURATION = 48_000;
export const TRANSITION_START = 60_800;
export const TARGET_END = TARGET_START + TARGET_DURATION;
export const PROJECT_END = 96_000;
export const TARGET_CLIP_ID = 'effect-target';
export const CANONICAL_TARGET_SOURCE_ID = 'canonical-target-video';
export const FALLBACK_SOURCE_ID = 'rendered-target-video';
export const UNAFFECTED_SOURCE_ID = 'unaffected-video';
export const AUDIO_SOURCE_ID = 'linked-audio';
export const FALLBACK_AUDIO_SOURCE_ID = 'rendered-audio-mix';
export const FALLBACK_DIGEST = 'de'.repeat(32);
export const FALLBACK_AUDIO_DIGEST = 'ac'.repeat(32);

export function clipFallbackProject(): AudioEditorProjectCurrent {
	const targetSource = createVideoSource({
		id: CANONICAL_TARGET_SOURCE_ID,
		storageKey: 'canonical-target-video-storage',
		frameCount: 96_000,
		sampleRate: SAMPLE_RATE,
		width: 1_280,
		height: 720,
		frameRate: 30,
		audioCodec: 'aac',
		hasAudio: true,
		opaqueExtensions: { byteLength: 90 },
	});
	const fallbackSource = createVideoSource({
		id: FALLBACK_SOURCE_ID,
		storageKey: 'rendered-target-video-storage',
		frameCount: TARGET_DURATION,
		sampleRate: SAMPLE_RATE,
		width: 1_280,
		height: 720,
		frameRate: 30,
		audioCodec: null,
		hasAudio: false,
		opaqueExtensions: { byteLength: 45 },
	});
	const unaffectedSource = createVideoSource({
		id: UNAFFECTED_SOURCE_ID,
		storageKey: 'unaffected-video-storage',
		frameCount: 72_000,
		sampleRate: SAMPLE_RATE,
		width: 1_280,
		height: 720,
		frameRate: 30,
		hasAudio: false,
		opaqueExtensions: { byteLength: 60 },
	});
	const audioSource = createAudioSource({
		id: AUDIO_SOURCE_ID,
		storageKey: 'linked-audio-storage',
		frameCount: TARGET_DURATION,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const fallbackAudioSource = createAudioSource({
		id: FALLBACK_AUDIO_SOURCE_ID,
		storageKey: 'rendered-audio-mix-storage',
		frameCount: PROJECT_END,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const targetClip = createVideoClip({
		id: TARGET_CLIP_ID,
		sourceId: targetSource.id,
		timelineStartFrame: TARGET_START,
		sourceStartFrame: 12_000,
		sourceDurationFrames: 36_000,
		durationFrames: TARGET_DURATION,
		trimStartFrames: 6_000,
		trimEndFrames: 10_000,
		speedRatio: 0.75,
		groupId: 'scene-group',
		avLinkId: 'target-av-link',
		videoEffects: [{
			id: 'pixelate-target', type: 'pixelate', enabled: true, params: { blockSize: 12 },
		}],
	});
	const unaffectedClip = createVideoClip({
		id: 'unaffected-clip',
		sourceId: unaffectedSource.id,
		timelineStartFrame: TRANSITION_START,
		durationFrames: PROJECT_END - TRANSITION_START,
	});
	const audioClip = createAudioClip({
		id: 'linked-audio-clip',
		sourceId: audioSource.id,
		timelineStartFrame: TARGET_START,
		durationFrames: TARGET_DURATION,
		groupId: 'scene-group',
		avLinkId: 'target-av-link',
	});
	return createCurrentAudioEditorProject({
		id: 'clip-fallback-export',
		title: 'Clip fallback export',
		now: '2026-08-03T12:00:00.000Z',
		sampleRate: SAMPLE_RATE,
		sources: [targetSource, fallbackSource, unaffectedSource, audioSource, fallbackAudioSource],
		clips: [targetClip, unaffectedClip, audioClip],
		tracks: [
			createVideoTrack({
				id: 'picture-track',
				clipIds: [targetClip.id, unaffectedClip.id],
				laneGroupId: 'camera-lane',
			}),
			createAudioTrack({
				id: 'linked-audio-track',
				clipIds: [audioClip.id],
				laneGroupId: 'camera-lane',
			}, SAMPLE_RATE),
		],
		featureRequirements: { schemaVersion: 2, requirements: [
			{
				id: 'publisher-audio-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
				displayName: 'Publisher audio render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'project-audio-mix-v1',
					kind: 'audio',
					sourceId: FALLBACK_AUDIO_SOURCE_ID,
					sha256: FALLBACK_AUDIO_DIGEST,
				},
			},
			{
				id: 'publisher-target-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher target render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'video-clip-render-v1',
					kind: 'video',
					sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST,
					targetClipId: TARGET_CLIP_ID,
				},
			},
		] },
	});
}
