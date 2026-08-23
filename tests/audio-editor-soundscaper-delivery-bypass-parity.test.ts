/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperPlaybackProjectServiceV21 } from '../src/soundscaper/editor-project-playback-v21.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';
import { createSoundscaperPlaybackProjectServiceV23 } from '../src/soundscaper/editor-project-playback-v23.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });
const NOW = '2026-08-19T12:00:00.000Z';

/**
 * Playback and export are the same render. Soundscaper marks video effects
 * unavailable and bypasses them during playback, so its video delivery
 * projection must carry the identical bypass — otherwise the exported file
 * shows the effect the preview suppressed.
 */
test('V23 video delivery carries the same video-effect bypass as playback', () => {
	const service = createSoundscaperPlaybackProjectServiceV23();
	const project = bypassProject(createSoundscaperProjectV23);
	const playback = service.projectForPlayback(project);
	const delivery = service.projectForVideoRenderedFallbackDelivery(project);

	assert.ok(playback.videoEffectPlaybackBypass, 'playback bypasses the maintained video effect');
	assert.deepEqual(
		clipVideoEffects(playback.project),
		clipVideoEffects(delivery.project),
		'the delivered clip effects match what playback rendered',
	);
	assert.equal(clipVideoEffects(delivery.project)?.[0]?.enabled, false);
});

test('V21 video delivery carries the same video-effect bypass as playback', () => {
	const service = createSoundscaperPlaybackProjectServiceV21();
	const project = bypassProject(createSoundscaperProjectV21);
	const playback = service.projectForPlayback(project);
	const delivery = service.projectForVideoRenderedFallbackDelivery(project);

	assert.ok(playback.videoEffectPlaybackBypass, 'playback bypasses the maintained video effect');
	assert.deepEqual(clipVideoEffects(playback.project), clipVideoEffects(delivery.project));
	assert.equal(clipVideoEffects(delivery.project)?.[0]?.enabled, false);
});

function clipVideoEffects(project: object) {
	const clips = (project as { clips: readonly Record<string, unknown>[] }).clips;
	return clips.find((clip) => clip.id === 'v-clip')?.videoEffects as
		readonly Readonly<{ enabled: boolean }>[] | undefined;
}

function bypassProject(create: (options: Record<string, unknown>) => object) {
	return create({
		id: 'bypass-parity', title: 'Bypass parity', now: NOW,
		sources: [
			createAudioSource({
				id: 'voice-source', storageKey: 'pcm:voice', contentSha256: 'a'.repeat(64),
				frameCount: SAMPLE_RATE * 10, channelCount: 1, sampleRate: SAMPLE_RATE,
				originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
			}),
			createVideoSource({
				id: 'cam', name: 'CAM', storageKey: 'media/cam.mp4', mimeType: 'video/mp4',
				frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, channelCount: 2,
				frameRate: PAL, width: 1920, height: 1080,
			}),
		],
		clips: [
			createAudioClip({
				id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0,
				durationFrames: SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
			}),
			{
				kind: 'video', id: 'v-clip', sourceId: 'cam', title: 'Wide', sequenceId: 'seq',
				sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
				videoEffects: [{ id: 'fx-1', type: 'pixelate', enabled: true, params: { blockSize: 16 } }],
			},
		],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createVideoTrack({ id: 'picture', name: 'Picture', clipIds: ['v-clip'] }),
		],
		sequences: [{
			id: 'seq', name: 'Sequence', rate: PAL,
			trackNodes: [
				{ kind: 'track', id: 'voice', parentFolderId: null },
				{ kind: 'track', id: 'picture', parentFolderId: null },
			],
		}],
		primarySequenceId: 'seq',
	});
}
