/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import type { ControllerTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperPlaybackProjectServiceV21 } from '../src/soundscaper/editor-project-playback-v21.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';
import { createSoundscaperPlaybackProjectServiceV23 } from '../src/soundscaper/editor-project-playback-v23.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';
import { createSoundscaperPlaybackProjectServiceV29 } from '../src/soundscaper/editor-project-playback-v29.ts';
import { createSoundscaperProjectV29 } from '../src/soundscaper/editor-project-v29.ts';
import { createSoundscaperPlaybackProjectServiceV30 } from '../src/soundscaper/editor-project-playback-v30.ts';
import { createSoundscaperProjectV30 } from '../src/soundscaper/editor-project-v30.ts';

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

for (const { version, createService, createProject } of [
	{
		version: 'V29',
		createService: createSoundscaperPlaybackProjectServiceV29,
		createProject: createSoundscaperProjectV29,
	},
	{
		version: 'V30',
		createService: createSoundscaperPlaybackProjectServiceV30,
		createProject: createSoundscaperProjectV30,
	},
]) {
	test(`${version} delivery carries the same effect bypasses as playback`, () => {
		const service = createService();
		const project = bypassProject(createProject as (options: Record<string, unknown>) => object);
		const playback = service.projectForPlayback(project);

		assert.ok(playback.videoEffectPlaybackBypass, 'playback bypasses the maintained video effect');
		const videoDelivery = service.projectForVideoRenderedFallbackDelivery(project);
		assert.deepEqual(
			clipVideoEffects(playback.project),
			clipVideoEffects(videoDelivery.project),
			'the delivered clip effects match what playback rendered',
		);
		assert.equal(clipVideoEffects(videoDelivery.project)?.[0]?.enabled, false);

		const audioDelivery = service.projectForAudioRenderedFallbackDelivery(project);
		assert.deepEqual(
			trackEffects(playback.project),
			trackEffects(audioDelivery.project),
			'audio delivery honors the audio-effect bypass playback applied',
		);
	});
}

test('the shared default delivery projections carry the same effect bypasses as playback', () => {
	// Playback and export are the same render: an effect bypassed for
	// playback must not reappear in the delivered file.
	const bypass = createCurrentAudioEditorProject({
		id: 'bypass-delivery', now: '2026-07-30T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'cam', name: 'CAM', storageKey: 'media/cam.mp4', mimeType: 'video/mp4',
			frameCount: 480_000, sampleRate: 48_000, channelCount: 2,
			frameRate: { num: 25, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [createVideoClip({
			id: 'v-clip', sourceId: 'cam', title: 'Wide', durationFrames: 25,
			videoEffects: [{ id: 'fx-1', type: 'pixelate', enabled: true, params: { blockSize: 16 } }],
		})],
		tracks: [
			createAudioTrack({ id: 'track', effects: [createEffect('limiter', { id: 'limiter-a' })] }),
			createVideoTrack({ id: 'picture', name: 'Picture', clipIds: ['v-clip'] }),
		],
	});
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: false });
	const playback = service.projectForPlayback(bypass);
	assert.equal((playback.project.tracks[0] as ControllerTrack | undefined)?.effects?.[0]?.bypassed, true);

	const audioDelivery = service.projectForAudioRenderedFallbackDelivery(bypass);
	assert.equal(
		(audioDelivery.project.tracks[0] as ControllerTrack | undefined)?.effects?.[0]?.bypassed,
		true,
		'audio delivery honors the audio-effect bypass playback applied',
	);

	const videoDelivery = service.projectForVideoRenderedFallbackDelivery(bypass);
	const deliveredClip = (videoDelivery.project.clips as readonly Record<string, unknown>[])
		.find((clip) => clip.id === 'v-clip');
	assert.equal(
		(deliveredClip?.videoEffects as readonly { enabled: boolean }[] | undefined)?.[0]?.enabled,
		false,
		'video delivery honors the video-effect bypass playback applied',
	);
	assert.equal(
		(videoDelivery.project.tracks[0] as ControllerTrack | undefined)?.effects?.[0]?.bypassed,
		true,
		'video delivery honors the audio-effect bypass playback applied',
	);
});

function trackEffects(project: object) {
	const tracks = (project as { tracks: readonly ControllerTrack[] }).tracks;
	return tracks.find((track) => track.id === 'voice')?.effects;
}

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
			createAudioTrack({
				id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
				effects: [createEffect('limiter', { id: 'limiter-a' })],
			}),
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
