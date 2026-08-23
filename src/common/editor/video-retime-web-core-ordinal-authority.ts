/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoRetimeExactOrdinalAuthority,
	type VideoRetimeExactOrdinalAuthority,
} from './video-retime-exact-ordinal-authority.ts';
import { createVideoRetimeExportIntentV6 } from './video-retime-export-plan.ts';
import { normalizeRational, type RationalInput, type RationalRate } from './timeline-time.ts';
import { resolveVideoCompositionIntervals, videoTimelineDurationFrames } from './video-timeline.js';
import {
	boundVideoSourceTimingViewInfo,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';

export interface VideoRetimeWebCoreOrdinalAuthorityRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly timingBySourceId: ReadonlyMap<string, BoundVideoSourceTimingView>;
	readonly startFrame?: number;
	readonly endFrame?: number;
	readonly outputRate: RationalInput;
}

/**
 * Capture the maintained web-core composition as one lazy exact ordinal authority.
 * Output index is the only presentation clock used by preview or browser delivery.
 */
export function createVideoRetimeWebCoreOrdinalAuthority(
	requestValue: VideoRetimeWebCoreOrdinalAuthorityRequest | unknown,
): VideoRetimeExactOrdinalAuthority {
	const request = requestRecord(requestValue);
	const project = record(request.project, 'web-core video-retime project');
	const sampleRate = positiveInteger(data(project, 'sampleRate', 'web-core video-retime project'), 'project.sampleRate');
	const startFrame = request.startFrame === undefined
		? 0 : nonNegativeInteger(request.startFrame, 'startFrame');
	const endFrame = request.endFrame === undefined
		? videoTimelineDurationFrames(project)
		: nonNegativeInteger(request.endFrame, 'endFrame');
	if (endFrame <= startFrame) throw new RangeError('Web-core video-retime range must be positive.');
	const primarySequenceId = identifier(
		data(project, 'primarySequenceId', 'web-core video-retime project'), 'project.primarySequenceId',
	);
	const sequences = records(data(project, 'sequences', 'web-core video-retime project'), 'project.sequences');
	const sequence = sequences.find((candidate) => (
		data(candidate, 'id', 'web-core video-retime sequence') === primarySequenceId
	));
	if (!sequence) throw new ReferenceError(`Primary video sequence ${primarySequenceId} is unavailable.`);
	const sequenceRate = rate(data(sequence, 'rate', 'web-core video-retime sequence'), 'sequence.rate');
	const outputRate = rate(request.outputRate, 'outputRate');
	const intervals = resolveVideoCompositionIntervals(project, {
		startFrame,
		endFrame,
	});
	const clipIds = new Set<string>();
	const topology = intervals.map((intervalValue: unknown) => {
		const interval = record(intervalValue, 'web-core video-retime interval');
		const layers = records(data(interval, 'layers', 'web-core video-retime interval'), 'interval.layers')
			.map((layer) => Object.freeze({
				clips: Object.freeze(records(data(layer, 'clips', 'web-core video-retime layer'), 'layer.clips')
					.map((entry) => {
						const clipId = identifier(data(entry, 'clipId', 'web-core video-retime entry'), 'entry.clipId');
						clipIds.add(clipId);
						return Object.freeze({ clipId });
					})),
			}));
		return Object.freeze({
			startSample: nonNegativeInteger(
				data(interval, 'timelineStartFrame', 'web-core video-retime interval'),
				'interval.timelineStartFrame',
			),
			endSample: positiveInteger(
				data(interval, 'timelineEndFrame', 'web-core video-retime interval'),
				'interval.timelineEndFrame',
			),
			layers: Object.freeze(layers),
		});
	});
	if (topology.length < 1) throw new RangeError('Web-core video-retime range has no composition topology.');
	const clips = records(data(project, 'clips', 'web-core video-retime project'), 'project.clips');
	const canonicalClips = clips.filter((clip) => clipIds.has(identifier(
		data(clip, 'id', 'web-core video-retime clip'), 'clip.id',
	))).map(persistedClip);
	if (canonicalClips.length !== clipIds.size) {
		throw new ReferenceError('Web-core video-retime topology references a missing canonical clip.');
	}
	const sourceIds = new Set(canonicalClips.map((clip) => identifier(
		data(clip, 'sourceId', 'web-core video-retime clip'), 'clip.sourceId',
	)));
	const timing = exactTiming(request.timingBySourceId, sourceIds);
	const intent = createVideoRetimeExportIntentV6({
		sampleStart: startFrame,
		sampleDuration: endFrame - startFrame,
		sampleRate,
		sequenceBinding: Object.freeze({ id: primarySequenceId, rate: sequenceRate }),
		outputRate,
		topology: Object.freeze(topology),
		canonicalClips: Object.freeze(canonicalClips),
	}, timing);
	return createVideoRetimeExactOrdinalAuthority(intent, timing);
}

function persistedClip(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const fields = [
		'kind', 'id', 'sourceId', 'sequenceId', 'sequenceStartFrame',
		'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount', 'retimeMap',
	] as const;
	return Object.freeze(Object.fromEntries(fields.map((key) => [
		key, data(value, key, 'web-core video-retime clip'),
	])));
}

function exactTiming(
	value: unknown,
	sourceIds: ReadonlySet<string>,
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	if (!(value instanceof Map)) throw new TypeError('Web-core video-retime timing must be a ReadonlyMap.');
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const sourceId of sourceIds) {
		const token = value.get(sourceId) as BoundVideoSourceTimingView | undefined;
		const info = boundVideoSourceTimingViewInfo(token);
		if (info.sourceId !== sourceId) throw new Error(`Video timing authority ${sourceId} is mismatched.`);
		result.set(sourceId, token!);
	}
	return result;
}

function requestRecord(value: unknown): VideoRetimeWebCoreOrdinalAuthorityRequest {
	const record_ = record(value, 'web-core video-retime authority request');
	const required = ['project', 'timingBySourceId', 'outputRate'];
	const allowed = new Set([...required, 'startFrame', 'endFrame']);
	const keys = Reflect.ownKeys(record_);
	if (required.some((key) => !keys.includes(key))
		|| keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError('Web-core video-retime authority request has an invalid closed shape.');
	}
	for (const key of keys) data(record_, String(key), 'web-core video-retime authority request');
	return record_ as unknown as VideoRetimeWebCoreOrdinalAuthorityRequest;
}

function records(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function rate(value: unknown, name: string): RationalRate {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
		return normalizeRational(value);
	}
	const candidate = record(value, name);
	const num = positiveInteger(data(candidate, 'num', name), `${name}.num`);
	const den = positiveInteger(data(candidate, 'den', name), `${name}.den`);
	const divisor = gcd(num, den);
	if (divisor !== 1) throw new RangeError(`${name} must be canonically reduced.`);
	return Object.freeze({ num, den });
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`${name} must be a bounded non-empty string.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function gcd(leftValue: number, rightValue: number): number {
	let left = leftValue;
	let right = rightValue;
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}
