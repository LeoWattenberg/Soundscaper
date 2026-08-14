/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	evaluateAutomationLaneAtFrameV21,
	normalizeAutomationLaneV21,
	resolveAutomationLanePointFramesV21,
	type AutomationLaneFrameOptionsV21,
	type AutomationLaneV21,
} from '../automation-lane-v21.ts';
import { createIndexedBeatFrameProjector } from '../indexed-tempo-projector.ts';
import type { ParameterDescriptor } from '../parameter-address.ts';
import type {
	ScheduledParameterEvent,
	ScheduledParameterRegistry,
	ScheduledParameterScheduleOptions,
} from './scheduled-parameter-registry.ts';

export const AUTOMATION_LANE_MAXIMUM_SCHEDULE_EVENTS_V21 = 16_384;

export interface CompileAutomationLaneEventsOptionsV21 extends AutomationLaneFrameOptionsV21 {
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly descriptor?: ParameterDescriptor;
	readonly maximumEvents?: number;
}

export interface ScheduleAutomationLaneOptionsV21 extends ScheduledParameterScheduleOptions {
	readonly toFrame: number;
	readonly tempoMap?: AutomationLaneFrameOptionsV21['tempoMap'];
	readonly maximumEvents?: number;
}

/** Compile an exact bounded playback window for ScheduledParameterRegistry. */
export function compileAutomationLaneEventsV21(
	value: unknown,
	options: CompileAutomationLaneEventsOptionsV21,
): readonly ScheduledParameterEvent[] {
	const lane = normalizeAutomationLaneV21(value, { descriptor: options.descriptor });
	const fromFrame = nonNegativeSafeInteger(options.fromFrame, 'fromFrame');
	const toFrame = nonNegativeSafeInteger(options.toFrame, 'toFrame');
	if (toFrame < fromFrame) throw new RangeError('Automation scheduling toFrame cannot precede fromFrame.');
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	const frameOptions = Object.freeze({ sampleRate, tempoMap: options.tempoMap });
	const maximumEvents = boundedMaximumEvents(options.maximumEvents);
	const tolerance = automationTolerance(options.descriptor);
	const resolved = resolveAutomationLanePointFramesV21(lane, frameOptions);
	const tempoBoundaries = resolvedTempoBoundaries(lane, frameOptions);
	const events: ScheduledParameterEvent[] = [];
	const append = (kind: ScheduledParameterEvent['kind'], frame: number, value: number): void => {
		const previous = events.at(-1);
		if (previous?.frame === frame && previous.value === value) return;
		if (events.length >= maximumEvents) {
			throw new RangeError(`Automation scheduling exceeds its ${String(maximumEvents)}-event ceiling.`);
		}
		events.push(Object.freeze({ kind, frame, value: canonicalValue(value) }));
	};
	const evaluate = (frame: number): number => evaluateAutomationLaneAtFrameV21(lane, frame, frameOptions);

	append('set', fromFrame, evaluate(fromFrame));
	if (toFrame === fromFrame || lane.points.length === 1) return Object.freeze(events);
	for (const [index, shape] of lane.segments.entries()) {
		const segmentStart = resolved[index]!.frame;
		const segmentEnd = resolved[index + 1]!.frame;
		if (segmentEnd < fromFrame || segmentStart > toFrame) continue;
		if (segmentEnd < segmentStart) throw new RangeError('Resolved automation points must not move backwards.');
		if (segmentStart === segmentEnd) {
			if (segmentEnd >= fromFrame && segmentEnd <= toFrame) {
				append('set', segmentEnd, lane.points[index + 1]!.value);
			}
			continue;
		}
		const start = Math.max(fromFrame, segmentStart);
		const end = Math.min(toFrame, segmentEnd);
		if (end < start) continue;
		if (start > fromFrame) {
			append('set', start, start === segmentStart ? lane.points[index]!.value : evaluate(start));
		}
		const boundaries = (shape.kind === 'hold' ? [] : tempoBoundaries
			.filter((frame) => frame > start && frame < end))
			.concat(end);
		let intervalStart = start;
		for (const intervalEnd of boundaries) {
			const startValue = intervalStart === segmentStart
				? lane.points[index]!.value
				: evaluate(intervalStart);
			const endValue = intervalEnd === segmentEnd
				? lane.points[index + 1]!.value
				: evaluate(intervalEnd);
			if (shape.kind === 'hold') append('set', intervalEnd, endValue);
			else if (shape.kind === 'linear') append('linear', intervalEnd, endValue);
			else appendCurvedInterval(
				intervalStart,
				intervalEnd,
				startValue,
				endValue,
				tolerance,
				evaluate,
				append,
			);
			intervalStart = intervalEnd;
		}
	}
	return Object.freeze(events);
}

/** Resolve the lane target from a graph registry and let that target apply latency exactly once. */
export function scheduleAutomationLaneV21(
	value: AutomationLaneV21 | unknown,
	registry: Pick<ScheduledParameterRegistry, 'get'>,
	options: ScheduleAutomationLaneOptionsV21,
): readonly ScheduledParameterEvent[] {
	const lane = normalizeAutomationLaneV21(value);
	const target = registry.get(lane.address);
	if (!target) throw new ReferenceError('The automation lane target is not registered in the active audio graph.');
	const events = compileAutomationLaneEventsV21(lane, {
		fromFrame: options.fromFrame,
		toFrame: options.toFrame,
		sampleRate: options.sampleRate,
		tempoMap: options.tempoMap,
		descriptor: target.descriptor,
		maximumEvents: options.maximumEvents,
	});
	target.schedule(events, {
		fromFrame: options.fromFrame,
		contextStartTime: options.contextStartTime,
		sampleRate: options.sampleRate,
		contextSampleRate: options.contextSampleRate,
		transportRate: options.transportRate,
	});
	return events;
}

function appendCurvedInterval(
	start: number,
	end: number,
	startValue: number,
	endValue: number,
	tolerance: number,
	evaluate: (frame: number) => number,
	append: (kind: ScheduledParameterEvent['kind'], frame: number, value: number) => void,
): void {
	if (end <= start + 1) {
		append('linear', end, endValue);
		return;
	}
	const probes = [...new Set([
		start + Math.floor((end - start) / 4),
		start + Math.floor((end - start) / 2),
		start + Math.floor((end - start) * 3 / 4),
	].filter((frame) => frame > start && frame < end))];
	let split = probes[0]!;
	let splitValue = evaluate(split);
	let maximumError = -1;
	for (const frame of probes) {
		const value = evaluate(frame);
		const progress = (frame - start) / (end - start);
		const linear = startValue + (endValue - startValue) * progress;
		const error = Math.abs(value - linear);
		if (error > maximumError) {
			split = frame;
			splitValue = value;
			maximumError = error;
		}
	}
	if (maximumError <= tolerance) {
		append('linear', end, endValue);
		return;
	}
	appendCurvedInterval(start, split, startValue, splitValue, tolerance, evaluate, append);
	appendCurvedInterval(split, end, splitValue, endValue, tolerance, evaluate, append);
}

function resolvedTempoBoundaries(
	lane: AutomationLaneV21,
	options: AutomationLaneFrameOptionsV21,
): readonly number[] {
	if (lane.timebase !== 'musical-beats') return Object.freeze([]);
	if (!options.tempoMap) throw new TypeError('A musical automation lane requires the project tempo map.');
	const project = createIndexedBeatFrameProjector(options.tempoMap, options.sampleRate);
	return Object.freeze([...new Set(options.tempoMap.events.map(({ beat }) => project(beat)))].sort(numberOrder));
}

function automationTolerance(descriptor: ParameterDescriptor | undefined): number {
	if (!descriptor) return 0.000_001;
	const value = descriptor.automationTolerance;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError('descriptor automationTolerance must be non-negative and finite.');
	}
	return value;
}

function boundedMaximumEvents(value: unknown): number {
	const maximum = value === undefined ? AUTOMATION_LANE_MAXIMUM_SCHEDULE_EVENTS_V21 : value;
	if (!Number.isSafeInteger(maximum) || Number(maximum) < 1
		|| Number(maximum) > AUTOMATION_LANE_MAXIMUM_SCHEDULE_EVENTS_V21) {
		throw new RangeError(
			`maximumEvents must be from 1 through ${String(AUTOMATION_LANE_MAXIMUM_SCHEDULE_EVENTS_V21)}.`,
		);
	}
	return Number(maximum);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function canonicalValue(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

function numberOrder(left: number, right: number): number {
	return left - right;
}
