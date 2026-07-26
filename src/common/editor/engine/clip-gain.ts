/* SPDX-License-Identifier: AGPL-3.0-only */

import { envelopeValueAtFrame } from '../automation.js';
import { linearRamp, setParam } from './audio-node-utils.ts';
import {
	clampFrame,
	finite,
	getProjectDurationFrames,
	nonNegativeInteger,
	positiveInteger,
} from './buffer-math.ts';
import type { FrameRange } from './clip-schedule-plan.ts';
import type { ProjectGainParams, ScheduledGainParam } from './project-graph.ts';
import type {
	EngineClip,
	EngineGainOwner,
	EngineProject,
} from './types.ts';

export interface ScheduleProjectGainsOptions {
	readonly context: BaseAudioContext;
	readonly project: EngineProject;
	readonly gainParams: Partial<ProjectGainParams>;
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly transportRate: number;
}

export function scheduleProjectGains({
	context,
	project,
	gainParams,
	fromFrame,
	toFrame,
	contextStartTime,
	sampleRate,
	transportRate,
}: ScheduleProjectGainsOptions): void {
	const timelineRate = sampleRate * transportRate;
	const durationFrames = Math.max(1, getProjectDurationFrames(project), toFrame);
	const scheduleEnvelope = (owner: EngineGainOwner | undefined, scheduled?: ScheduledGainParam): void => {
		if (!scheduled?.param || !Array.isArray(owner?.envelope) || !owner.envelope.length) return;
		const baseGain = Math.max(0, finite(owner.gain, 1));
		const latencySeconds = nonNegativeInteger(scheduled.latencyFrames, 0)
			/ positiveInteger(context.sampleRate, sampleRate);
		const startTime = contextStartTime + latencySeconds;
		setParam(
			scheduled.param,
			baseGain * envelopeValueAtFrame(owner.envelope, fromFrame, durationFrames),
			startTime,
		);
		for (const point of owner.envelope) {
			if (point.frame <= fromFrame || point.frame >= toFrame) continue;
			linearRamp(
				scheduled.param,
				baseGain * Math.max(0, finite(point.value, 1)),
				startTime + (point.frame - fromFrame) / timelineRate,
			);
		}
		if (toFrame > fromFrame) {
			linearRamp(
				scheduled.param,
				baseGain * envelopeValueAtFrame(owner.envelope, toFrame, durationFrames),
				startTime + (toFrame - fromFrame) / timelineRate,
			);
		}
	};
	for (const [trackIndex, track] of (project.tracks || []).entries()) {
		if (track.type === 'label' || track.type === 'video') continue;
		scheduleEnvelope(track, gainParams.tracks?.get(String(track.id ?? trackIndex)));
	}
	for (const [index, bus] of (project.mixer?.groups || []).entries()) {
		scheduleEnvelope(bus, gainParams.groups?.get(String(bus.id ?? index)));
	}
	for (const [index, bus] of (project.mixer?.sends || []).entries()) {
		scheduleEnvelope(bus, gainParams.sends?.get(String(bus.id ?? index)));
	}
	scheduleEnvelope(project.master, gainParams.master || undefined);
}

export interface ClipGainOptions {
	readonly crossfadeInRanges?: readonly FrameRange[];
	readonly crossfadeOutRanges?: readonly FrameRange[];
}

export function scheduleClipGain(
	fadeInParam: AudioParam,
	fadeOutParam: AudioParam,
	clipGainParam: AudioParam,
	clip: EngineClip,
	segmentStart: number,
	segmentEnd: number,
	duration: number,
	startTime: number,
	sampleRate: number,
	options: ClipGainOptions = {},
): void {
	const baseGain = Math.max(0, finite(clip.gain, 1));
	const envelope = Array.isArray(clip.envelope) ? clip.envelope : [];
	setParam(clipGainParam, baseGain * envelopeValueAtFrame(envelope, segmentStart, duration), startTime);
	if (envelope.length) {
		for (const point of envelope) {
			if (point.frame <= segmentStart || point.frame >= segmentEnd) continue;
			linearRamp(
				clipGainParam,
				baseGain * Math.max(0, finite(point.value, 1)),
				startTime + (point.frame - segmentStart) / sampleRate,
			);
		}
		if (segmentEnd > segmentStart) {
			linearRamp(
				clipGainParam,
				baseGain * envelopeValueAtFrame(envelope, segmentEnd, duration),
				startTime + (segmentEnd - segmentStart) / sampleRate,
			);
		}
	}
	const fadeIn = clampFrame(clip.fadeInFrames, 0, duration);
	const fadeOut = clampFrame(clip.fadeOutFrames, 0, duration);
	const crossfadeInRanges = options.crossfadeInRanges || [];
	const crossfadeOutRanges = options.crossfadeOutRanges || [];
	const fadeInAt = (frame: number): number => (
		(fadeIn > 0 && frame < fadeIn ? Math.max(0, frame / fadeIn) : 1)
		* crossfadeGainAt(frame, crossfadeInRanges, 'in')
	);
	const fadeOutAt = (frame: number): number => (
		(fadeOut > 0 && frame > duration - fadeOut
			? Math.max(0, (duration - frame) / fadeOut)
			: 1)
		* crossfadeGainAt(frame, crossfadeOutRanges, 'out')
	);
	scheduleGainAutomation(fadeInParam, fadeInAt, segmentStart, segmentEnd, startTime, sampleRate, [
		0, fadeIn, ...crossfadeInRanges.flat(),
	]);
	scheduleGainAutomation(fadeOutParam, fadeOutAt, segmentStart, segmentEnd, startTime, sampleRate, [
		duration - fadeOut, duration, ...crossfadeOutRanges.flat(),
	]);
}

export function crossfadeGainAt(
	frame: number,
	ranges: readonly FrameRange[],
	direction: 'in' | 'out',
): number {
	let gain = 1;
	for (const [start, end] of ranges) {
		if (frame < start || frame > end) continue;
		const progress = end > start ? (frame - start) / (end - start) : 1;
		const value = direction === 'in' ? progress : 1 - progress;
		gain = Math.min(gain, Math.max(0, Math.min(1, value)));
	}
	return gain;
}

function scheduleGainAutomation(
	param: AudioParam,
	evaluate: (frame: number) => number,
	segmentStart: number,
	segmentEnd: number,
	startTime: number,
	sampleRate: number,
	boundaries: readonly number[],
): void {
	setParam(param, evaluate(segmentStart), startTime);
	const points = [...new Set(boundaries
		.filter((frame) => Number.isFinite(frame) && frame > segmentStart && frame < segmentEnd))]
		.sort((left, right) => left - right);
	for (const frame of points) {
		linearRamp(param, evaluate(frame), startTime + (frame - segmentStart) / sampleRate);
	}
	if (segmentEnd > segmentStart) {
		linearRamp(param, evaluate(segmentEnd), startTime + (segmentEnd - segmentStart) / sampleRate);
	}
}
