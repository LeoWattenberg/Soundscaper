/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../../src/common/editor/project-media-factory.ts';

export const WARP_PROJECT_ID = 'audio-warp-cross-product-project';
export const WARP_SOURCE_ID = 'audio-warp-cross-product-source';
export const WARP_STORAGE_KEY = 'physical/audio-warp-cross-product-source';

export const WARP_CHANNELS = Object.freeze([
	Object.freeze([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]),
]);

export const WARP_MAP = Object.freeze({
	feature: 'audio-warp',
	points: Object.freeze([
		Object.freeze({ outer: Object.freeze({ num: 0, den: 1 }), source: Object.freeze({ num: 0, den: 1 }), mode: 'forward' as const }),
		Object.freeze({ outer: Object.freeze({ num: 4, den: 1 }), source: Object.freeze({ num: 2, den: 1 }), mode: 'forward' as const }),
		Object.freeze({ outer: Object.freeze({ num: 8, den: 1 }), source: Object.freeze({ num: 8, den: 1 }), mode: 'forward' as const }),
	]),
});

export interface AudioWarpSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
}

export interface AudioWarpProjectFixture {
	readonly project: AudioEditorProjectCurrent;
	readonly source: AudioWarpSource;
	readonly channels: readonly (readonly number[])[];
}

/** A current project with one nonidentity native audio-warp map and exact owned PCM. */
export function createAudioWarpProjectFixture(): AudioWarpProjectFixture {
	const source = createAudioSource({
		id: WARP_SOURCE_ID,
		storageKey: WARP_STORAGE_KEY,
		name: 'Warped ramp.wav',
		mimeType: 'audio/wav',
		frameCount: WARP_CHANNELS[0]!.length,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: WARP_CHANNELS[0]!.length,
	}) as AudioWarpSource;
	const clip = createAudioClip({
		id: 'audio-warp-cross-product-clip',
		sourceId: source.id,
		name: 'Nonidentity warped ramp',
		timelineStartFrame: 0,
		durationFrames: 8,
		sourceStartFrame: 0,
		sourceDurationFrames: 8,
		warpMap: WARP_MAP,
	});
	const track = createAudioTrack({
		id: 'audio-warp-cross-product-track',
		name: 'Warped audio',
		clipIds: [clip.id],
	});
	const project = createCurrentAudioEditorProject({
		id: WARP_PROJECT_ID,
		title: 'Audio warp cross-product project',
		revision: 5,
		now: '2026-08-12T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [track],
		sequences: [{ id: 'audio-warp-cross-product-sequence', trackIds: [track.id] }],
		primarySequenceId: 'audio-warp-cross-product-sequence',
	});
	return Object.freeze({ project, source, channels: WARP_CHANNELS });
}
