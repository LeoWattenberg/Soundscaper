/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Independent admission for the static composition graph export plan.
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
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from './video-export-plan-version.ts';
import { isVideoCanvasFit, type VideoCanvasFit } from './video-canvas-fit.ts';
import { isVideoDeliveryQuality, type VideoDeliveryQuality } from './video-delivery-quality.ts';
import { isVideoDeliveryAudioLayout } from './video-delivery-audio-layout.ts';
import { isVideoCaptionSidecarFormat } from './video-caption-cues.ts';
import {
	VIDEO_BURN_IN_MAXIMUM_CUES,
	VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH,
} from './video-caption-burn-in.ts';

export const NATIVE_MEDIA_GRAPH_PLAN_MAXIMUM_INPUTS = 4_096;
export const NATIVE_MEDIA_GRAPH_PLAN_MAXIMUM_INTERVALS = 100_000;

export type NativeMediaGraphPlanFormat = 'mp4' | 'webm';

export interface NativeMediaGraphPlanRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}

export interface NativeMediaGraphPlanCanvas {
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly fit: VideoCanvasFit;
	readonly pixelFormat: string;
	readonly backgroundColor: string;
	readonly maximumWidth: number;
	readonly maximumHeight: number;
	readonly maximumFrameRate: number;
	readonly referenceClipId: string | null;
	readonly referenceSourceId: string | null;
}

export interface NativeMediaGraphPlanCodecs {
	readonly video: string;
	readonly videoEncoder: string;
	readonly audio: string | null;
	readonly audioEncoder: string | null;
	readonly pixelFormat: string;
}

export interface NativeMediaGraphPlanVideoInput {
	readonly kind: 'video-source';
	readonly inputIndex: number;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly presentation: Readonly<Record<string, unknown>> | null;
}

export interface NativeMediaGraphPlanAudioInput {
	readonly kind: 'staged-audio-mix';
	readonly inputIndex: number;
	readonly fileName: string;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly durationFrames: number;
}

export type NativeMediaGraphPlanInput = NativeMediaGraphPlanVideoInput | NativeMediaGraphPlanAudioInput;

export interface NativeMediaGraphPlan extends Readonly<Record<string, unknown>> {
	readonly version: typeof CANONICAL_VIDEO_EXPORT_PLAN_VERSION;
	readonly format: NativeMediaGraphPlanFormat;
	readonly container: NativeMediaGraphPlanFormat;
	readonly extension: NativeMediaGraphPlanFormat;
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly codecs: NativeMediaGraphPlanCodecs;
	readonly quality: VideoDeliveryQuality;
	readonly captions: Readonly<Record<string, unknown>> | null;
	readonly range: NativeMediaGraphPlanRange;
	readonly durationSeconds: number;
	readonly outputFrameCount: number;
	readonly canvas: NativeMediaGraphPlanCanvas;
	readonly inputs: readonly NativeMediaGraphPlanInput[];
	readonly intervals: readonly Readonly<Record<string, unknown>>[];
	readonly filterPlan: Readonly<Record<string, unknown>>;
}

const PLAN_KEYS = Object.freeze([
	'version', 'format', 'container', 'extension', 'mimeType', 'codecs', 'quality', 'captions', 'range',
	'durationSeconds', 'outputFrameCount', 'canvas', 'inputs', 'intervals', 'filterPlan',
]);
const CAPTIONS_KEYS = Object.freeze([
	'trackId', 'cueCount', 'mux', 'burnIn', 'subtitleCodec', 'sidecarFormat',
]);
const BURN_IN_KEYS = Object.freeze([
	'fontSizePx', 'bottomMarginPx', 'boxBorderPx', 'lineSpacingPx', 'cues',
]);
const BURN_IN_CUE_KEYS = Object.freeze(['index', 'startSeconds', 'endSeconds', 'text']);
const CAPTION_INPUT_KEYS = Object.freeze(['kind', 'inputIndex', 'fileName', 'format']);
const CODEC_KEYS = Object.freeze(['video', 'videoEncoder', 'audio', 'audioEncoder', 'pixelFormat']);
const RANGE_KEYS = Object.freeze(['startFrame', 'endFrame', 'durationFrames']);
const CANVAS_KEYS = Object.freeze([
	'width', 'height', 'frameRate', 'fit', 'pixelFormat', 'backgroundColor',
	'maximumWidth', 'maximumHeight', 'maximumFrameRate', 'referenceClipId', 'referenceSourceId',
]);
const VIDEO_INPUT_KEYS = Object.freeze([
	'kind', 'inputIndex', 'sourceId', 'storageKey', 'mimeType', 'presentation',
]);
const AUDIO_INPUT_KEYS = Object.freeze([
	'kind', 'inputIndex', 'fileName', 'sampleRate', 'startFrame', 'durationFrames', 'channelLayout',
]);
const FILTER_PLAN_KEYS = Object.freeze([
	'strategy', 'backgroundColor', 'intervals', 'concat', 'audio', 'burnIn', 'output',
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
	subject: 'Video export graph plan',
	requirePlainPrototype: true,
	raise: (message: string): never => nativeMediaPlanViolation('malformed', message),
});

/** Admit an independently parsed static composition plan. */
export function assertNativeMediaGraphPlan(value: unknown): asserts value is NativeMediaGraphPlan {
	const plan = record(value, 'video export graph plan');
	exactKeys(plan, PLAN_KEYS, 'video export graph plan');
	if (plan.version !== CANONICAL_VIDEO_EXPORT_PLAN_VERSION) {
		nativeMediaPlanViolation(
			'unsupported-version',
			`A static composition plan must declare version ${String(CANONICAL_VIDEO_EXPORT_PLAN_VERSION)}.`,
		);
	}
	const format = planFormat(plan.format);
	if (plan.container !== format || plan.extension !== format
		|| plan.mimeType !== FORMAT_MIME_TYPES[format]) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan format metadata is not canonical.');
	}
	assertCodecs(plan.codecs);
	if (!isVideoDeliveryQuality(plan.quality)) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan states an unsupported delivery quality.');
	}
	assertCaptions(plan.captions);
	const range = assertRange(plan.range);
	if (range.durationFrames <= 0) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan must cover at least one sample frame.');
	}
	positiveFinite(plan.durationSeconds, 'durationSeconds');
	positiveInteger(plan.outputFrameCount, 'outputFrameCount');
	assertCanvas(plan.canvas);
	assertInputs(plan.inputs, range);
	assertIntervals(plan.intervals, range);
	const filterPlan = record(plan.filterPlan, 'video export graph plan filterPlan');
	exactKeys(filterPlan, FILTER_PLAN_KEYS, 'video export graph plan filterPlan');
	if (filterPlan.strategy !== 'layered-composition') {
		nativeMediaPlanViolation('malformed', 'Video export graph plan must declare the layered-composition filter strategy.');
	}
	assertBurnIn(filterPlan.burnIn, plan.captions);
}

/**
 * The burn-in stage, which is present exactly when the captions say it is.
 *
 * The engine reads user text out of this stage and writes it to disk to draw
 * from, so every cue is bounded here rather than trusted: a stage disagreeing
 * with its own caption decision, or carrying text past what a caption line is,
 * describes a delivery this build did not plan.
 */
function assertBurnIn(value: unknown, captionsValue: unknown): void {
	const wanted = Boolean(captionsValue) && typeof captionsValue === 'object'
		&& (captionsValue as Record<string, unknown>).burnIn === true;
	if (value === null) {
		// A burn-in that resolved to nothing to draw is legitimate: every cue in
		// range may have been blank. The decision stands; the stage is empty.
		return;
	}
	if (!wanted) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan burns in captions it never asked for.');
	}
	const burnIn = record(value, 'video export graph plan burnIn');
	exactKeys(burnIn, BURN_IN_KEYS, 'video export graph plan burnIn');
	positiveInteger(burnIn.fontSizePx, 'burnIn.fontSizePx');
	positiveInteger(burnIn.boxBorderPx, 'burnIn.boxBorderPx');
	nonNegativeInteger(burnIn.bottomMarginPx, 'burnIn.bottomMarginPx');
	nonNegativeInteger(burnIn.lineSpacingPx, 'burnIn.lineSpacingPx');
	const cues = arrayValue(burnIn.cues, 'video export graph plan burnIn cues');
	if (cues.length > VIDEO_BURN_IN_MAXIMUM_CUES) {
		nativeMediaPlanViolation('oversized', 'Video export graph plan burns in more cues than the engine admits.');
	}
	for (const [index, entry] of cues.entries()) {
		const cue = record(entry, 'video export graph plan burnIn cue');
		exactKeys(cue, BURN_IN_CUE_KEYS, 'video export graph plan burnIn cue');
		if (nonNegativeInteger(cue.index, 'burnIn cue index') !== index) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan burn-in cue indices are not their own positions.');
		}
		const start = nonNegativeFinite(cue.startSeconds, 'burnIn cue startSeconds');
		if (nonNegativeFinite(cue.endSeconds, 'burnIn cue endSeconds') < start) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan burn-in cue ends before it starts.');
		}
		if (typeof cue.text !== 'string' || cue.text.length < 1
			|| cue.text.length > VIDEO_BURN_IN_MAXIMUM_TEXT_LENGTH || cue.text.includes('\0')) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan burn-in cue text is not a bounded caption line.');
		}
	}
}

/** Count the enabled clip effects the static plan asks the engine to apply. */
export function nativeMediaGraphPlanVideoEffectCount(plan: NativeMediaGraphPlan): number {
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
	const codecs = record(value, 'video export graph plan codecs');
	exactKeys(codecs, CODEC_KEYS, 'video export graph plan codecs');
	nonEmptyText(codecs.video, 'codecs.video');
	nonEmptyText(codecs.videoEncoder, 'codecs.videoEncoder');
	nonEmptyText(codecs.pixelFormat, 'codecs.pixelFormat');
	const audio = codecs.audio;
	const audioEncoder = codecs.audioEncoder;
	if ((audio === null) !== (audioEncoder === null)) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan must state audio codec and encoder together.');
	}
	if (audio !== null) {
		nonEmptyText(audio, 'codecs.audio');
		nonEmptyText(audioEncoder, 'codecs.audioEncoder');
	}
}

/**
 * The caption decision, which most plans do not make at all.
 *
 * Null is not merely allowed here, it is the shape every plan carried before
 * captions existed, so it is admitted without further reading. A stated
 * decision has to be complete: a mux with no codec, or a delivery that is
 * neither muxed nor a sidecar, describes a caption track nothing would produce.
 */
function assertCaptions(value: unknown): void {
	if (value === null) return;
	const captions = record(value, 'video export graph plan captions');
	exactKeys(captions, CAPTIONS_KEYS, 'video export graph plan captions');
	nonEmptyText(captions.trackId, 'captions.trackId');
	nonNegativeInteger(captions.cueCount, 'captions.cueCount');
	if (typeof captions.mux !== 'boolean' || typeof captions.burnIn !== 'boolean') {
		nativeMediaPlanViolation('malformed', 'Video export graph plan caption delivery flags must be boolean.');
	}
	if (captions.mux) nonEmptyText(captions.subtitleCodec, 'captions.subtitleCodec');
	else if (captions.subtitleCodec !== null) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan states a caption codec it does not mux.');
	}
	if (captions.sidecarFormat !== null && !isVideoCaptionSidecarFormat(captions.sidecarFormat)) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan states an unsupported caption sidecar format.');
	}
	if (!captions.mux && !captions.burnIn && captions.sidecarFormat === null) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan states captions it delivers nowhere.');
	}
}

function assertRange(value: unknown): NativeMediaGraphPlanRange {
	const range = record(value, 'video export graph plan range');
	exactKeys(range, RANGE_KEYS, 'video export graph plan range');
	const startFrame = nonNegativeInteger(range.startFrame, 'range.startFrame');
	const endFrame = nonNegativeInteger(range.endFrame, 'range.endFrame');
	const durationFrames = nonNegativeInteger(range.durationFrames, 'range.durationFrames');
	if (endFrame - startFrame !== durationFrames) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan range duration is not its exact frame span.');
	}
	return Object.freeze({ startFrame, endFrame, durationFrames });
}

function assertCanvas(value: unknown): void {
	const canvas = record(value, 'video export graph plan canvas');
	exactKeys(canvas, CANVAS_KEYS, 'video export graph plan canvas');
	const width = positiveInteger(canvas.width, 'canvas.width');
	const height = positiveInteger(canvas.height, 'canvas.height');
	const maximumWidth = positiveInteger(canvas.maximumWidth, 'canvas.maximumWidth');
	const maximumHeight = positiveInteger(canvas.maximumHeight, 'canvas.maximumHeight');
	if (width > maximumWidth || height > maximumHeight) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan canvas exceeds its own declared maximum.');
	}
	const frameRate = positiveFinite(canvas.frameRate, 'canvas.frameRate');
	const maximumFrameRate = positiveFinite(canvas.maximumFrameRate, 'canvas.maximumFrameRate');
	if (frameRate > maximumFrameRate) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan frame rate exceeds its own declared maximum.');
	}
	if (!isVideoCanvasFit(canvas.fit)) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan canvas states an unsupported fit.');
	}
	nonEmptyText(canvas.pixelFormat, 'canvas.pixelFormat');
	nonEmptyText(canvas.backgroundColor, 'canvas.backgroundColor');
	optionalText(canvas.referenceClipId, 'canvas.referenceClipId');
	optionalText(canvas.referenceSourceId, 'canvas.referenceSourceId');
}

function assertInputs(value: unknown, range: NativeMediaGraphPlanRange): void {
	const inputs = arrayValue(value, 'video export graph plan inputs');
	if (inputs.length > NATIVE_MEDIA_GRAPH_PLAN_MAXIMUM_INPUTS) {
		nativeMediaPlanViolation('oversized', 'Video export graph plan declares more inputs than the engine admits.');
	}
	const sourceIds = new Set<string>();
	let audioInputs = 0;
	let captionInputs = 0;
	for (const [index, entry] of inputs.entries()) {
		const input = record(entry, 'video export graph plan input');
		const kind = input.kind;
		if (kind === 'video-source') {
			exactKeys(input, VIDEO_INPUT_KEYS, 'video export graph plan video input');
			const sourceId = nonEmptyText(input.sourceId, 'input.sourceId');
			if (sourceIds.has(sourceId)) {
				nativeMediaPlanViolation('malformed', 'Video export graph plan repeats a source input.');
			}
			sourceIds.add(sourceId);
			nonEmptyText(input.storageKey, 'input.storageKey');
			nonEmptyText(input.mimeType, 'input.mimeType');
			if (input.presentation !== null) record(input.presentation, 'input.presentation');
		} else if (kind === 'staged-audio-mix') {
			exactKeys(input, AUDIO_INPUT_KEYS, 'video export graph plan audio input');
			nonEmptyText(input.fileName, 'input.fileName');
			positiveInteger(input.sampleRate, 'input.sampleRate');
			if (nonNegativeInteger(input.startFrame, 'input.startFrame') !== range.startFrame
				|| nonNegativeInteger(input.durationFrames, 'input.durationFrames') !== range.durationFrames) {
				nativeMediaPlanViolation('malformed', 'Video export graph plan staged audio does not cover its own export range.');
			}
			if (!isVideoDeliveryAudioLayout(input.channelLayout)) {
				nativeMediaPlanViolation('malformed', 'Video export graph plan staged audio states an unsupported channel layout.');
			}
			audioInputs += 1;
		} else if (kind === 'staged-captions') {
			exactKeys(input, CAPTION_INPUT_KEYS, 'video export graph plan caption input');
			nonEmptyText(input.fileName, 'input.fileName');
			if (input.format !== 'srt') {
				nativeMediaPlanViolation('malformed', 'Video export graph plan stages captions in an unsupported document format.');
			}
			captionInputs += 1;
		} else {
			nativeMediaPlanViolation('malformed', 'Video export graph plan carries an unknown input kind.');
		}
		if (nonNegativeInteger(input.inputIndex, 'input.inputIndex') !== index) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan input indices are not their own positions.');
		}
	}
	if (audioInputs > 1) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan declares more than one staged audio mix.');
	}
	if (captionInputs > 1) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan declares more than one staged caption document.');
	}
}

function assertIntervals(value: unknown, range: NativeMediaGraphPlanRange): void {
	const intervals = arrayValue(value, 'video export graph plan intervals');
	if (intervals.length > NATIVE_MEDIA_GRAPH_PLAN_MAXIMUM_INTERVALS) {
		nativeMediaPlanViolation('oversized', 'Video export graph plan declares more intervals than the engine admits.');
	}
	let covered = range.startFrame;
	for (const [index, entry] of intervals.entries()) {
		const interval = record(entry, 'video export graph plan interval');
		exactOptionalKeys(interval, INTERVAL_KEYS, INTERVAL_OPTIONAL_KEYS, 'video export graph plan interval');
		if (nonNegativeInteger(interval.index, 'interval.index') !== index) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan interval indices are not their own positions.');
		}
		nonEmptyText(interval.kind, 'interval.kind');
		const startFrame = nonNegativeInteger(interval.timelineStartFrame, 'interval.timelineStartFrame');
		const endFrame = nonNegativeInteger(interval.timelineEndFrame, 'interval.timelineEndFrame');
		const durationFrames = nonNegativeInteger(interval.durationFrames, 'interval.durationFrames');
		if (endFrame - startFrame !== durationFrames || durationFrames <= 0) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan interval duration is not its exact frame span.');
		}
		if (startFrame < range.startFrame || endFrame > range.endFrame) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan interval leaves its own export range.');
		}
		// The intervals are the export's own tiling, so each one begins exactly
		// where the previous ended: a gap renders nothing and an overlap renders
		// the same source frames into two output positions.
		if (startFrame !== covered) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan intervals do not tile their own export range.');
		}
		if (nonNegativeInteger(interval.outputStartFrame, 'interval.outputStartFrame') !== startFrame - range.startFrame) {
			nativeMediaPlanViolation('malformed', 'Video export graph plan interval output offset is not its range offset.');
		}
		positiveFinite(interval.durationSeconds, 'interval.durationSeconds');
		assertLayers(interval.layers);
		covered = endFrame;
	}
	if (covered !== range.endFrame) {
		nativeMediaPlanViolation('malformed', 'Video export graph plan intervals do not tile their own export range.');
	}
}

function assertLayers(value: unknown): void {
	for (const entry of arrayValue(value, 'video export graph plan interval layers')) {
		const layer = record(entry, 'video export graph plan interval layer');
		exactKeys(layer, LAYER_KEYS, 'video export graph plan interval layer');
		nonEmptyText(layer.trackId, 'layer.trackId');
		nonNegativeInteger(layer.trackIndex, 'layer.trackIndex');
		for (const clipEntry of arrayValue(layer.clips, 'video export graph plan layer clips')) {
			const clip = record(clipEntry, 'video export graph plan layer clip');
			nonEmptyText(clip.clipId, 'clip.clipId');
			nonEmptyText(clip.sourceId, 'clip.sourceId');
			nonNegativeInteger(clip.inputIndex, 'clip.inputIndex');
			arrayValue(clip.videoEffects, 'clip.videoEffects');
		}
	}
}

function planFormat(value: unknown): NativeMediaGraphPlanFormat {
	if (value !== 'mp4' && value !== 'webm') {
		nativeMediaPlanViolation('malformed', 'Video export graph plan must name a supported container.');
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
	const descriptor = Object.getOwnPropertyDescriptor(record(container, 'video export graph plan record'), key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		nativeMediaPlanViolation('malformed', `Video export graph plan is missing the data property ${key}.`);
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
		nativeMediaPlanViolation('malformed', `Video export graph plan ${label} must be bounded non-empty text.`);
	}
	return value;
}

function optionalText(value: unknown, label: string): string | null {
	return value === null ? null : nonEmptyText(value, label);
}

function positiveInteger(value: unknown, label: string): number {
	const number = nonNegativeInteger(value, label);
	if (number === 0) {
		nativeMediaPlanViolation('malformed', `Video export graph plan ${label} must be greater than zero.`);
	}
	return number;
}

function positiveFinite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		nativeMediaPlanViolation('malformed', `Video export graph plan ${label} must be a positive finite number.`);
	}
	return value;
}

function nonNegativeFinite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		nativeMediaPlanViolation('malformed', `Video export graph plan ${label} must be a non-negative finite number.`);
	}
	return value;
}
