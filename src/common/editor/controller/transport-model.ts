/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';

export interface AudioEditorMetronomeScheduleOptions {
	readonly bpm: unknown;
	readonly sampleRate: unknown;
	readonly positionFrame?: unknown;
	readonly playbackRate?: unknown;
}

export interface AudioEditorMetronomeSchedule {
	readonly beatIndex: number;
	readonly delaySeconds: number;
	readonly beatDurationSeconds: number;
}

export function calculateAudioEditorMetronomeSchedule({
	bpm,
	sampleRate,
	positionFrame = 0,
	playbackRate = 1,
}: AudioEditorMetronomeScheduleOptions): Readonly<AudioEditorMetronomeSchedule> {
	const normalizedBpm = Math.max(1, Number(bpm) || 120);
	const normalizedSampleRate = Math.max(1, Number(sampleRate) || AUDIO_EDITOR_SAMPLE_RATE);
	const normalizedPosition = Math.max(0, Number(positionFrame) || 0);
	const requestedPlaybackRate = Number(playbackRate);
	const normalizedPlaybackRate = Number.isFinite(requestedPlaybackRate) && requestedPlaybackRate > 0
		? requestedPlaybackRate
		: 1;
	const beatFrames = normalizedSampleRate * 60 / normalizedBpm;
	const beatIndex = Math.ceil(normalizedPosition / beatFrames);
	const nextBeatFrame = beatIndex * beatFrames;
	return Object.freeze({
		beatIndex,
		delaySeconds: Math.max(0, (nextBeatFrame - normalizedPosition) / (normalizedSampleRate * normalizedPlaybackRate)),
		beatDurationSeconds: 60 / (normalizedBpm * normalizedPlaybackRate),
	});
}
