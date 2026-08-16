/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Independent admission for the static V6 composition export plan.
 *
 * `createVideoExportPlan` builds this document in the renderer, but a native
 * media consumer must never trust a plan merely because something in-process
 * produced it: it re-parses the plan it was handed and admits it against the
 * exact canonical shape, or refuses the job before any I/O. The V7 keyed plan
 * already owns `assertVideoKeyframeExportPlanV7`; this module is its static
 * counterpart.
 */

import {
	NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_DEPTH,
	nativeMediaPlanViolation,
} from './native-media-plan-canonical-form.ts';
import { createNativeValidators } from './native-validation.ts';

export const NATIVE_MEDIA_PLAN_V6_MAXIMUM_INPUTS = 4_096;
export const NATIVE_MEDIA_PLAN_V6_MAXIMUM_INTERVALS = 100_000;

export type NativeMediaPlanV6Format = 'mp4' | 'webm';

export interface NativeMediaPlanV6Range {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}

export interface NativeMediaPlanV6Canvas {
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly pixelFormat: string;
	readonly backgroundColor: string;
	readonly maximumWidth: number;
	readonly maximumHeight: number;
	readonly maximumFrameRate: number;
	readonly referenceClipId: string | null;
	readonly referenceSourceId: string | null;
}

export interface NativeMediaPlanV6Codecs {
	readonly video: string;
	readonly videoEncoder: string;
	readonly audio: string | null;
	readonly audioEncoder: string | null;
	readonly pixelFormat: string;
}

export interface NativeMediaPlanV6VideoInput {
	readonly kind: 'video-source';
	readonly inputIndex: number;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly presentation: Readonly<Record<string, unknown>> | null;
}

export interface NativeMediaPlanV6AudioInput {
	readonly kind: 'staged-audio-mix';
	readonly inputIndex: number;
	readonly fileName: string;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly durationFrames: number;
}

export type NativeMediaPlanV6Input = NativeMediaPlanV6VideoInput | NativeMediaPlanV6AudioInput;

export interface NativeMediaPlanV6 extends Readonly<Record<string, unknown>> {
	readonly version: 6;
	readonly format: NativeMediaPlanV6Format;
	readonly container: NativeMediaPlanV6Format;
	readonly extension: NativeMediaPlanV6Format;
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly codecs: NativeMediaPlanV6Codecs;
	readonly range: NativeMediaPlanV6Range;
	readonly durationSeconds: number;
	readonly outputFrameCount: number;
	readonly canvas: NativeMediaPlanV6Canvas;
	readonly inputs: readonly NativeMediaPlanV6Input[];
	readonly intervals: readonly Readonly<Record<string, unknown>>[];
	readonly filterPlan: Readonly<Record<string, unknown>>;
}

const PLAN_KEYS = Object.freeze([
	'version', 'format', 'container', 'extension', 'mimeType', 'codecs', 'range',
	'durationSeconds', 'outputFrameCount', 'canvas', 'inputs', 'intervals', 'filterPlan',
]);
const CODEC_KEYS = Object.freeze(['video', 'videoEncoder', 'audio', 'audioEncoder', 'pixelFormat']);
const RANGE_KEYS = Object.freeze(['startFrame', 'endFrame', 'durationFrames']);
const CANVAS_KEYS = Object.freeze([
	'width', 'height', 'frameRate', 'pixelFormat', 'backgroundColor',
	'maximumWidth', 'maximumHeight', 'maximumFrameRate', 'referenceClipId', 'referenceSourceId',
]);
const VIDEO_INPUT_KEYS = Object.freeze([
	'kind', 'inputIndex', 'sourceId', 'storageKey', 'mimeType', 'presentation',
]);
const AUDIO_INPUT_KEYS = Object.freeze([
	'kind', 'inputIndex', 'fileName', 'sampleRate', 'startFrame', 'durationFrames',
]);
const FILTER_PLAN_KEYS = Object.freeze([
	'strategy', 'backgroundColor', 'intervals', 'concat', 'audio', 'output',
]);
const INTERVAL_KEYS = Object.freeze([
	'index', 'kind', 'timelineStartFrame', 'timelineEndFrame', 'outputStartFrame',
	'durationFrames', 'durationSeconds', 'color', 'layers',
]);
const INTERVAL_OPTIONAL_KEYS: ReadonlySet<string> = new Set(['color']);
const EMPTY_OPTIONAL_KEYS: ReadonlySet<string> = new Set<string>();
const LAYER_KEYS = Object.freeze(['trackId', 'trackIndex', 'clips']);

const FORMAT_MIME_TYPES = Object.freeze({
	mp4: 'video/mp4',
	webm: 'video/webm',
} as const);

// A plan arrives as re-parsed JSON, so an exotic prototype is never legitimate
// here even though the other native contracts admit one.
const { nonNegativeInteger, plainRecord: record } = createNativeValidators({
	subject: 'Video export plan V6',
	requirePlainPrototype: true,
	raise: (message: string): never => nativeMediaPlanViolation('malformed', message),
});

/** Admit an independently parsed static composition plan. */
export function assertNativeMediaPlanV6(value: unknown): asserts value is NativeMediaPlanV6 {
	const plan = record(value, 'video export plan V6');
	exactKeys(plan, PLAN_KEYS, 'video export plan V6');
	if (plan.version !== 6) {
		nativeMediaPlanViolation('unsupported-version', 'A static composition plan must declare version 6.');
	}
	const format = planFormat(plan.format);
	if (plan.container !== format || plan.extension !== format
		|| plan.mimeType !== FORMAT_MIME_TYPES[format]) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 format metadata is not canonical.');
	}
	assertCodecs(plan.codecs);
	const range = assertRange(plan.range);
	if (range.durationFrames <= 0) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 must cover at least one sample frame.');
	}
	positiveFinite(plan.durationSeconds, 'durationSeconds');
	positiveInteger(plan.outputFrameCount, 'outputFrameCount');
	assertCanvas(plan.canvas);
	assertInputs(plan.inputs, range);
	assertIntervals(plan.intervals, range);
	const filterPlan = record(plan.filterPlan, 'video export plan V6 filterPlan');
	exactKeys(filterPlan, FILTER_PLAN_KEYS, 'video export plan V6 filterPlan');
	if (filterPlan.strategy !== 'layered-composition') {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 must declare the layered-composition filter strategy.');
	}
}

/** Count the enabled clip effects the static plan asks the engine to apply. */
export function nativeMediaPlanV6VideoEffectCount(plan: NativeMediaPlanV6): number {
	let total = 0;
	for (const interval of plan.intervals) {
		for (const layer of arrayValue(dataValue(interval, 'layers'), 'interval.layers')) {
			for (const clip of arrayValue(dataValue(record(layer, 'interval layer'), 'clips'), 'layer.clips')) {
				const effects = dataValue(record(clip, 'layer clip'), 'videoEffects');
				total += arrayValue(effects, 'clip.videoEffects').length;
			}
		}
	}
	return total;
}

function assertCodecs(value: unknown): void {
	const codecs = record(value, 'video export plan V6 codecs');
	exactKeys(codecs, CODEC_KEYS, 'video export plan V6 codecs');
	nonEmptyText(codecs.video, 'codecs.video');
	nonEmptyText(codecs.videoEncoder, 'codecs.videoEncoder');
	nonEmptyText(codecs.pixelFormat, 'codecs.pixelFormat');
	const audio = codecs.audio;
	const audioEncoder = codecs.audioEncoder;
	if ((audio === null) !== (audioEncoder === null)) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 must state audio codec and encoder together.');
	}
	if (audio !== null) {
		nonEmptyText(audio, 'codecs.audio');
		nonEmptyText(audioEncoder, 'codecs.audioEncoder');
	}
}

function assertRange(value: unknown): NativeMediaPlanV6Range {
	const range = record(value, 'video export plan V6 range');
	exactKeys(range, RANGE_KEYS, 'video export plan V6 range');
	const startFrame = nonNegativeInteger(range.startFrame, 'range.startFrame');
	const endFrame = nonNegativeInteger(range.endFrame, 'range.endFrame');
	const durationFrames = nonNegativeInteger(range.durationFrames, 'range.durationFrames');
	if (endFrame - startFrame !== durationFrames) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 range duration is not its exact frame span.');
	}
	return Object.freeze({ startFrame, endFrame, durationFrames });
}

function assertCanvas(value: unknown): void {
	const canvas = record(value, 'video export plan V6 canvas');
	exactKeys(canvas, CANVAS_KEYS, 'video export plan V6 canvas');
	const width = positiveInteger(canvas.width, 'canvas.width');
	const height = positiveInteger(canvas.height, 'canvas.height');
	const maximumWidth = positiveInteger(canvas.maximumWidth, 'canvas.maximumWidth');
	const maximumHeight = positiveInteger(canvas.maximumHeight, 'canvas.maximumHeight');
	if (width > maximumWidth || height > maximumHeight) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 canvas exceeds its own declared maximum.');
	}
	const frameRate = positiveFinite(canvas.frameRate, 'canvas.frameRate');
	const maximumFrameRate = positiveFinite(canvas.maximumFrameRate, 'canvas.maximumFrameRate');
	if (frameRate > maximumFrameRate) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 frame rate exceeds its own declared maximum.');
	}
	nonEmptyText(canvas.pixelFormat, 'canvas.pixelFormat');
	nonEmptyText(canvas.backgroundColor, 'canvas.backgroundColor');
	optionalText(canvas.referenceClipId, 'canvas.referenceClipId');
	optionalText(canvas.referenceSourceId, 'canvas.referenceSourceId');
}

function assertInputs(value: unknown, range: NativeMediaPlanV6Range): void {
	const inputs = arrayValue(value, 'video export plan V6 inputs');
	if (inputs.length > NATIVE_MEDIA_PLAN_V6_MAXIMUM_INPUTS) {
		nativeMediaPlanViolation('oversized', 'Video export plan V6 declares more inputs than the engine admits.');
	}
	const sourceIds = new Set<string>();
	let audioInputs = 0;
	for (const [index, entry] of inputs.entries()) {
		const input = record(entry, 'video export plan V6 input');
		const kind = input.kind;
		if (kind === 'video-source') {
			exactKeys(input, VIDEO_INPUT_KEYS, 'video export plan V6 video input');
			const sourceId = nonEmptyText(input.sourceId, 'input.sourceId');
			if (sourceIds.has(sourceId)) {
				nativeMediaPlanViolation('malformed', 'Video export plan V6 repeats a source input.');
			}
			sourceIds.add(sourceId);
			nonEmptyText(input.storageKey, 'input.storageKey');
			nonEmptyText(input.mimeType, 'input.mimeType');
			if (input.presentation !== null) record(input.presentation, 'input.presentation');
		} else if (kind === 'staged-audio-mix') {
			exactKeys(input, AUDIO_INPUT_KEYS, 'video export plan V6 audio input');
			nonEmptyText(input.fileName, 'input.fileName');
			positiveInteger(input.sampleRate, 'input.sampleRate');
			if (nonNegativeInteger(input.startFrame, 'input.startFrame') !== range.startFrame
				|| nonNegativeInteger(input.durationFrames, 'input.durationFrames') !== range.durationFrames) {
				nativeMediaPlanViolation('malformed', 'Video export plan V6 staged audio does not cover its own export range.');
			}
			audioInputs += 1;
		} else {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 carries an unknown input kind.');
		}
		if (nonNegativeInteger(input.inputIndex, 'input.inputIndex') !== index) {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 input indices are not their own positions.');
		}
	}
	if (audioInputs > 1) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 declares more than one staged audio mix.');
	}
}

function assertIntervals(value: unknown, range: NativeMediaPlanV6Range): void {
	const intervals = arrayValue(value, 'video export plan V6 intervals');
	if (intervals.length > NATIVE_MEDIA_PLAN_V6_MAXIMUM_INTERVALS) {
		nativeMediaPlanViolation('oversized', 'Video export plan V6 declares more intervals than the engine admits.');
	}
	let covered = range.startFrame;
	for (const [index, entry] of intervals.entries()) {
		const interval = record(entry, 'video export plan V6 interval');
		exactOptionalKeys(interval, INTERVAL_KEYS, INTERVAL_OPTIONAL_KEYS, 'video export plan V6 interval');
		if (nonNegativeInteger(interval.index, 'interval.index') !== index) {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 interval indices are not their own positions.');
		}
		nonEmptyText(interval.kind, 'interval.kind');
		const startFrame = nonNegativeInteger(interval.timelineStartFrame, 'interval.timelineStartFrame');
		const endFrame = nonNegativeInteger(interval.timelineEndFrame, 'interval.timelineEndFrame');
		const durationFrames = nonNegativeInteger(interval.durationFrames, 'interval.durationFrames');
		if (endFrame - startFrame !== durationFrames || durationFrames <= 0) {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 interval duration is not its exact frame span.');
		}
		if (startFrame < range.startFrame || endFrame > range.endFrame) {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 interval leaves its own export range.');
		}
		// The intervals are the export's own tiling, so each one begins exactly
		// where the previous ended: a gap renders nothing and an overlap renders
		// the same source frames into two output positions.
		if (startFrame !== covered) {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 intervals do not tile their own export range.');
		}
		if (nonNegativeInteger(interval.outputStartFrame, 'interval.outputStartFrame') !== startFrame - range.startFrame) {
			nativeMediaPlanViolation('malformed', 'Video export plan V6 interval output offset is not its range offset.');
		}
		positiveFinite(interval.durationSeconds, 'interval.durationSeconds');
		assertLayers(interval.layers);
		covered = endFrame;
	}
	if (covered !== range.endFrame) {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 intervals do not tile their own export range.');
	}
}

function assertLayers(value: unknown): void {
	for (const entry of arrayValue(value, 'video export plan V6 interval layers')) {
		const layer = record(entry, 'video export plan V6 interval layer');
		exactKeys(layer, LAYER_KEYS, 'video export plan V6 interval layer');
		nonEmptyText(layer.trackId, 'layer.trackId');
		nonNegativeInteger(layer.trackIndex, 'layer.trackIndex');
		for (const clipEntry of arrayValue(layer.clips, 'video export plan V6 layer clips')) {
			const clip = record(clipEntry, 'video export plan V6 layer clip');
			nonEmptyText(clip.clipId, 'clip.clipId');
			nonEmptyText(clip.sourceId, 'clip.sourceId');
			nonNegativeInteger(clip.inputIndex, 'clip.inputIndex');
			arrayValue(clip.videoEffects, 'clip.videoEffects');
		}
	}
}

function planFormat(value: unknown): NativeMediaPlanV6Format {
	if (value !== 'mp4' && value !== 'webm') {
		nativeMediaPlanViolation('malformed', 'Video export plan V6 must name a supported container.');
	}
	return value;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) {
		nativeMediaPlanViolation('malformed', `A ${label} must be an array.`);
	}
	return value as readonly unknown[];
}

function dataValue(container: unknown, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record(container, 'video export plan V6 record'), key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		nativeMediaPlanViolation('malformed', `Video export plan V6 is missing the data property ${key}.`);
	}
	return descriptor.value;
}

/**
 * Field order is part of the canonical document, exactly as the V7 plan already
 * requires: a re-ordered record is a different document, not a formatting
 * variant, and admitting it would let a peer launder one past the fingerprint.
 */
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	exactOptionalKeys(value, keys, EMPTY_OPTIONAL_KEYS, label);
}

function exactOptionalKeys(
	value: Record<string, unknown>,
	fields: readonly string[],
	optional: ReadonlySet<string>,
	label: string,
): void {
	const present = Object.keys(value);
	let index = 0;
	for (const field of fields) {
		if (present[index] === field) {
			index += 1;
		} else if (!optional.has(field)) {
			nativeMediaPlanViolation('malformed', `A ${label} must carry exactly its schema keys in canonical order.`);
		}
	}
	if (index !== present.length) {
		nativeMediaPlanViolation('malformed', `A ${label} must carry exactly its schema keys in canonical order.`);
	}
}

function nonEmptyText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_DEPTH * 1_024) {
		nativeMediaPlanViolation('malformed', `Video export plan V6 ${label} must be bounded non-empty text.`);
	}
	return value;
}

function optionalText(value: unknown, label: string): string | null {
	return value === null ? null : nonEmptyText(value, label);
}

function positiveInteger(value: unknown, label: string): number {
	const number = nonNegativeInteger(value, label);
	if (number === 0) {
		nativeMediaPlanViolation('malformed', `Video export plan V6 ${label} must be greater than zero.`);
	}
	return number;
}

function positiveFinite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		nativeMediaPlanViolation('malformed', `Video export plan V6 ${label} must be a positive finite number.`);
	}
	return value;
}
