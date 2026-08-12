/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../../src/common/editor/project-current.ts';
import {
	createAudioSourceV10,
	createAudioTrackV10,
} from '../../src/common/editor/project-v10.ts';

export const TAKE_PROJECT_ID = 'take-only-cross-product-project';
export const TAKE_SEQUENCE_ID = 'take-only-main-sequence';
export const TAKE_TRACK_ID = 'take-only-vocal-track';

const TAKE_A_CHANNELS = Object.freeze([
	Object.freeze([0.125, -0.25, 0.5, -1, 0.75, -0.5, 0.25, 0]),
]);
const TAKE_B_CHANNELS = Object.freeze([
	Object.freeze([-0.375, 0.625, -0.875, 1, -0.125, 0.5, -0.75, 0.25]),
]);

export interface TakeOnlyAudioSource extends Readonly<Record<string, unknown>> {
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

export interface TakeOnlyPcmFixture {
	readonly source: TakeOnlyAudioSource;
	readonly channels: readonly (readonly number[])[];
}

export interface TakeOnlyProjectFixture {
	readonly project: AudioEditorProjectCurrent;
	readonly pcm: readonly TakeOnlyPcmFixture[];
}

/** A current project whose PCM has no logical root except its two take lanes. */
export function createTakeOnlyProjectFixture(): TakeOnlyProjectFixture {
	const first = audioSource(
		'take-only-source-a',
		'physical/take-only-source-a',
		'Take lane A.wav',
		TAKE_A_CHANNELS[0]!.length,
	);
	const second = audioSource(
		'take-only-source-b',
		'physical/take-only-source-b',
		'Take lane B.wav',
		TAKE_B_CHANNELS[0]!.length,
	);
	const project = createCurrentAudioEditorProject({
		id: TAKE_PROJECT_ID,
		title: 'Take-only cross-product project',
		revision: 7,
		now: '2026-08-12T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [first, second],
		clips: [],
		tracks: [createAudioTrackV10({
			id: TAKE_TRACK_ID,
			name: 'Vocal takes',
			clipIds: [],
		})],
		sequences: [{ id: TAKE_SEQUENCE_ID, trackIds: [TAKE_TRACK_ID] }],
		primarySequenceId: TAKE_SEQUENCE_ID,
		takeGroups: [{
			id: 'take-only-group',
			sequenceId: TAKE_SEQUENCE_ID,
			trackId: TAKE_TRACK_ID,
			startSample: 96,
			endSample: 104,
			laneOrder: ['take-only-lane-a', 'take-only-lane-b'],
			lanes: [{ id: 'take-only-lane-a' }, { id: 'take-only-lane-b' }],
			takes: [{
				id: 'take-only-take-a',
				laneId: 'take-only-lane-a',
				sourceId: first.id,
				startSample: 96,
				endSample: 104,
				sourceStartSample: 0,
			}, {
				id: 'take-only-take-b',
				laneId: 'take-only-lane-b',
				sourceId: second.id,
				startSample: 96,
				endSample: 104,
				sourceStartSample: 0,
			}],
			compRegions: [{
				id: 'take-only-region-a',
				takeId: 'take-only-take-a',
				startSample: 96,
				endSample: 100,
			}, {
				id: 'take-only-region-b',
				takeId: 'take-only-take-b',
				startSample: 100,
				endSample: 104,
			}],
		}],
	});
	return Object.freeze({
		project,
		pcm: Object.freeze([
			Object.freeze({ source: first, channels: TAKE_A_CHANNELS }),
			Object.freeze({ source: second, channels: TAKE_B_CHANNELS }),
		]),
	});
}

function audioSource(
	id: string,
	storageKey: string,
	name: string,
	frameCount: number,
): TakeOnlyAudioSource {
	return createAudioSourceV10({
		id,
		storageKey,
		name,
		mimeType: 'audio/wav',
		frameCount,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: frameCount,
	}) as TakeOnlyAudioSource;
}
