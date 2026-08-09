/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';
import {
	beatToSampleFrame,
	normalizeRational,
	roundRational,
} from '../timeline-time.ts';

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
	const bpmRate = normalizeRational(normalizedBpm);
	const beatIndex = roundRational(
		BigInt(normalizedPosition) * BigInt(bpmRate.num),
		BigInt(normalizedSampleRate) * 60n * BigInt(bpmRate.den),
		'enclosingEnd',
	);
	const nextBeatFrame = beatToSampleFrame(beatIndex, {
		mode: 'musical',
		events: [{ beat: { num: 0, den: 1 }, bpm: bpmRate }],
	}, normalizedSampleRate);
	return Object.freeze({
		beatIndex,
		delaySeconds: Math.max(0, (nextBeatFrame - normalizedPosition) / (normalizedSampleRate * normalizedPlaybackRate)),
		beatDurationSeconds: 60 / (normalizedBpm * normalizedPlaybackRate),
	});
}
