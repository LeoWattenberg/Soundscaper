/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	estimateAudacityEffectPeakBytes,
} from '../audacity-effects/contracts.js';
import { EDITOR_TIMELINE_MINIMUM_SECONDS } from '../project.js';
import type { EngineClip, EngineProject } from './types.ts';

export const DEFAULT_SAMPLE_RATE = 48_000;
export const MAX_EFFECT_TAIL_SECONDS = 10;
export const PLAY_AT_SPEED_MINIMUM_RATE = 0.5;
export const PLAY_AT_SPEED_MAXIMUM_RATE = 2;
export const PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES = AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES;

export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

export function finite(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function positiveInteger(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

export function nonNegativeInteger(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: fallback;
}

export function clampFrame(value: unknown, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, nonNegativeInteger(value, minimum)));
}

export function clipStart(clip: EngineClip | null | undefined): number {
	return nonNegativeInteger(clip?.timelineStartFrame ?? clip?.timelineStartFrames, 0);
}

export function clipDuration(clip: EngineClip | null | undefined): number {
	return nonNegativeInteger(clip?.durationFrames ?? clip?.frameLength, 0);
}

export function getProjectClips(project: EngineProject | null | undefined): EngineClip[] {
	if (Array.isArray(project?.clips)) return [...project.clips];
	const clips: EngineClip[] = [];
	for (const track of project?.tracks || []) {
		for (const clip of track.clips || []) {
			if (clip && typeof clip === 'object') clips.push(clip as EngineClip);
		}
	}
	return clips;
}

export function getProjectDurationFrames(project: EngineProject | null | undefined): number {
	let duration = 0;
	for (const clip of getProjectClips(project)) {
		duration = Math.max(duration, clipStart(clip) + clipDuration(clip));
	}
	return duration;
}

export function getProjectTimelineDurationFrames(project: EngineProject | null | undefined): number {
	const sampleRate = positiveInteger(project?.sampleRate, DEFAULT_SAMPLE_RATE);
	return Math.max(
		getProjectDurationFrames(project) * 2,
		Math.round(sampleRate * EDITOR_TIMELINE_MINIMUM_SECONDS),
	);
}

export interface NormalizedLoop {
	readonly enabled: boolean;
	readonly startFrame: number;
	readonly endFrame: number;
}

export function normalizeLoop(value: unknown, durationFrames: number): NormalizedLoop {
	const candidate = value && typeof value === 'object'
		? value as { enabled?: unknown; startFrame?: unknown; endFrame?: unknown }
		: {};
	const startFrame = clampFrame(candidate.startFrame, 0, durationFrames);
	const endFrame = clampFrame(candidate.endFrame ?? durationFrames, startFrame, durationFrames);
	return { enabled: Boolean(candidate.enabled) && endFrame > startFrame, startFrame, endFrame };
}

export function normalizePlayAtSpeedRate(value: unknown): number {
	const rate = Number(value);
	if (!Number.isFinite(rate) || rate < PLAY_AT_SPEED_MINIMUM_RATE || rate > PLAY_AT_SPEED_MAXIMUM_RATE) {
		throw new RangeError(`Playback speed must be between ${PLAY_AT_SPEED_MINIMUM_RATE} and ${PLAY_AT_SPEED_MAXIMUM_RATE}.`);
	}
	return rate;
}

export function estimatePlayAtSpeedStaffPadPeakBytes(
	durationFrames: unknown,
	sampleRate: unknown,
	playbackRate: unknown,
): number {
	const frames = Math.max(1, nonNegativeInteger(durationFrames, 0));
	const rate = normalizePlayAtSpeedRate(playbackRate);
	return estimateAudacityEffectPeakBytes(
		'audacity-change-tempo',
		frames,
		{ tempoPercent: (rate - 1) * 100 },
		{ channelCount: 2, sampleRate: positiveInteger(sampleRate, DEFAULT_SAMPLE_RATE) },
	);
}

export function assertPlayAtSpeedStaffPadMemorySafe(
	durationFrames: unknown,
	sampleRate: unknown,
	playbackRate: unknown,
): number {
	const estimatedBytes = estimatePlayAtSpeedStaffPadPeakBytes(durationFrames, sampleRate, playbackRate);
	if (estimatedBytes <= PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES) return estimatedBytes;
	throw Object.assign(new RangeError(
		`Pitch-preserving whole-project playback needs an estimated ${estimatedBytes} bytes, exceeding the ${PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES}-byte browser memory limit.`,
	), { code: 'PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT' });
}

export type PlanarPcm = Readonly<{
	channels: readonly (Float32Array | ArrayLike<number>)[];
}>;

export function audioBufferChannels(buffer: AudioBuffer | PlanarPcm): Float32Array[] {
	if ('channels' in buffer && Array.isArray(buffer.channels)) {
		return buffer.channels.map((channel) => channel instanceof Float32Array
			? channel
			: new Float32Array(channel));
	}
	const audioBuffer = buffer as AudioBuffer;
	const channelCount = nonNegativeInteger(audioBuffer.numberOfChannels, 0);
	if (!channelCount || typeof audioBuffer.getChannelData !== 'function') {
		throw new TypeError('Pitch-preserving playback requires rendered PCM channels.');
	}
	return Array.from({ length: channelCount }, (_, channel) => audioBuffer.getChannelData(channel));
}

export interface PreparedSpeedPlayback {
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly durationFrames: number;
	readonly playbackRate: number;
	readonly audioBuffer: null;
}

export function normalizePreparedSpeedPlayback(
	channels: readonly (Float32Array | ArrayLike<number> | null | undefined)[],
	sampleRate: unknown,
	durationFrames: unknown,
	playbackRate: unknown,
): PreparedSpeedPlayback {
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
		throw new RangeError('Pitch-preserving playback requires one or two PCM channels.');
	}
	const normalized = channels.map((channel) => channel instanceof Float32Array
		? channel
		: new Float32Array(channel || []));
	const frameCount = normalized[0].length;
	if (!frameCount || normalized.some((channel) => channel.length !== frameCount)) {
		throw new RangeError('Pitch-preserving playback channels must have one matching frame length.');
	}
	return {
		channels: normalized,
		frameCount,
		sampleRate: positiveInteger(sampleRate, DEFAULT_SAMPLE_RATE),
		durationFrames: nonNegativeInteger(durationFrames, 0),
		playbackRate: normalizePlayAtSpeedRate(playbackRate),
		audioBuffer: null,
	};
}

export function getReversedBuffer(
	context: BaseAudioContext,
	original: AudioBuffer,
	cache: WeakMap<AudioBuffer, AudioBuffer>,
): AudioBuffer {
	const cached = cache.get(original);
	if (cached) return cached;
	const reversed = context.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
	for (let channel = 0; channel < original.numberOfChannels; channel += 1) {
		const input = original.getChannelData(channel);
		const output = reversed.getChannelData(channel);
		for (let index = 0; index < input.length; index += 1) output[index] = input[input.length - index - 1];
	}
	cache.set(original, reversed);
	return reversed;
}

export function sliceAudioBuffer(
	context: BaseAudioContext,
	input: AudioBuffer,
	startFrame: number,
	frameCount: number,
): AudioBuffer {
	const length = Math.max(1, Math.min(frameCount, input.length - startFrame));
	const output = context.createBuffer(input.numberOfChannels, length, input.sampleRate);
	for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
		const values = input.getChannelData(channel).subarray(startFrame, startFrame + length);
		if (typeof output.copyToChannel === 'function') output.copyToChannel(values, channel);
		else output.getChannelData(channel).set(values);
	}
	return output;
}

export function createImpulseResponse(context: BaseAudioContext, duration: number, decay: number): AudioBuffer {
	const length = Math.max(1, Math.round(duration * context.sampleRate));
	const impulse = context.createBuffer(2, length, context.sampleRate);
	for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
		const data = impulse.getChannelData(channel);
		let seed = 0x1234567 + channel * 997;
		for (let index = 0; index < length; index += 1) {
			seed = (seed * 16807) % 2147483647;
			const noise = seed / 1073741823.5 - 1;
			data[index] = noise * ((1 - index / length) ** decay);
		}
	}
	return impulse;
}

export function createGateCurve(thresholdDb: number): Float32Array<ArrayBuffer> {
	const points = 2_049;
	const curve = new Float32Array(points);
	const threshold = 10 ** (thresholdDb / 20);
	for (let index = 0; index < points; index += 1) {
		const value = index / (points - 1) * 2 - 1;
		curve[index] = Math.abs(value) < threshold ? 0 : value;
	}
	return curve;
}
