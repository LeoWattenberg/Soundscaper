/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	buildAudioWarpRuntimeSegments,
	createAudioWarpRuntimeEvaluator,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeProject,
	type AudioWarpRuntimeRange,
} from './audio-warp-runtime.ts';

export const AUDIO_WARP_PCM_PARITY_ERROR_BUDGET = 0.000_001;

export interface AudioWarpPcmParityEvidence {
	readonly breakpointCount: number;
	readonly comparedFrameCount: number;
	readonly comparedSampleCount: number;
	readonly maximumSignalError: number;
	readonly errorBudget: number;
}

/** Independently sample every timeline frame through the exact map evaluator. */
export function renderExactAudioWarpPcm(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpRuntimeClip,
	range: AudioWarpRuntimeRange,
	sourceChannels: readonly Float32Array[],
): readonly Float32Array[] {
	const channels = normalizeSourceChannels(sourceChannels);
	const frameCount = outputFrameCount(range);
	const evaluator = createAudioWarpRuntimeEvaluator(project, clip);
	return Object.freeze(channels.map((source) => {
		const output = new Float32Array(frameCount);
		for (let outputFrame = 0; outputFrame < frameCount; outputFrame += 1) {
			const timelineFrame = range.startFrame + outputFrame;
			const position = evaluator.sourceAtTimelineFrame(timelineFrame);
			output[outputFrame] = interpolateSource(source, position.num / position.den);
		}
		return output;
	}));
}

/** Render the live scheduler's piecewise rate/offset projection into PCM. */
export function renderRealtimeAudioWarpPcmProjection(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpRuntimeClip,
	range: AudioWarpRuntimeRange,
	sourceChannels: readonly Float32Array[],
): readonly Float32Array[] {
	const channels = normalizeSourceChannels(sourceChannels);
	const frameCount = outputFrameCount(range);
	const output = channels.map(() => new Float32Array(frameCount));
	const segments = buildAudioWarpRuntimeSegments(project, clip, range);
	for (const segment of segments) {
		const sourceStart = segment.sourceStartFrame.num / segment.sourceStartFrame.den;
		const sourceFramesPerTimelineFrame = segment.playbackRate
			* range.sourceSampleRate / project.sampleRate;
		for (let timelineFrame = segment.timelineStartFrame;
			timelineFrame < segment.timelineEndFrame;
			timelineFrame += 1) {
			const outputFrame = timelineFrame - range.startFrame;
			const sourceFrame = sourceStart
				+ (timelineFrame - segment.timelineStartFrame) * sourceFramesPerTimelineFrame;
			for (let channel = 0; channel < channels.length; channel += 1) {
				output[channel]![outputFrame] = interpolateSource(channels[channel]!, sourceFrame);
			}
		}
	}
	return Object.freeze(output);
}

/** Compare independently rendered live-schedule and exact-evaluator PCM signals. */
export function evaluateAudioWarpPcmRenderParity(
	project: AudioWarpRuntimeProject,
	clip: AudioWarpRuntimeClip,
	range: AudioWarpRuntimeRange,
	sourceChannels: readonly Float32Array[],
): Readonly<AudioWarpPcmParityEvidence> {
	const exact = renderExactAudioWarpPcm(project, clip, range, sourceChannels);
	const realtime = renderRealtimeAudioWarpPcmProjection(project, clip, range, sourceChannels);
	let maximumSignalError = 0;
	for (let channel = 0; channel < exact.length; channel += 1) {
		for (let frame = 0; frame < exact[channel]!.length; frame += 1) {
			maximumSignalError = Math.max(
				maximumSignalError,
				Math.abs(exact[channel]![frame]! - realtime[channel]![frame]!),
			);
		}
	}
	if (maximumSignalError > AUDIO_WARP_PCM_PARITY_ERROR_BUDGET) {
		throw new Error('Audio warp realtime and exact-offline PCM exceed their signal error budget.');
	}
	const segments = buildAudioWarpRuntimeSegments(project, clip, range);
	return Object.freeze({
		breakpointCount: new Set(segments.flatMap((segment) => (
			[segment.timelineStartFrame, segment.timelineEndFrame]
		))).size,
		comparedFrameCount: exact[0]?.length ?? 0,
		comparedSampleCount: (exact[0]?.length ?? 0) * exact.length,
		maximumSignalError,
		errorBudget: AUDIO_WARP_PCM_PARITY_ERROR_BUDGET,
	});
}

function normalizeSourceChannels(value: readonly Float32Array[]): readonly Float32Array[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 32
		|| !(value[0] instanceof Float32Array) || value[0].length < 1
		|| value.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== value[0]!.length)) {
		throw new RangeError('Audio warp PCM parity requires one to 32 matching source channels.');
	}
	for (const channel of value) {
		for (const sample of channel) {
			if (!Number.isFinite(sample)) throw new RangeError('Audio warp PCM parity requires finite samples.');
		}
	}
	return value;
}

function outputFrameCount(range: AudioWarpRuntimeRange): number {
	const frameCount = range.endFrame - range.startFrame;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
		throw new RangeError('Audio warp PCM parity requires a positive timeline range.');
	}
	return frameCount;
}

function interpolateSource(source: Float32Array, position: number): number {
	if (!Number.isFinite(position) || position < 0 || position > source.length) {
		throw new RangeError('Audio warp PCM projection exceeded its source geometry.');
	}
	const left = Math.min(source.length - 1, Math.floor(position));
	const right = Math.min(source.length - 1, left + 1);
	const fraction = position - Math.floor(position);
	return source[left]! + (source[right]! - source[left]!) * fraction;
}
