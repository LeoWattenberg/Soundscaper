/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic AutoFlip-style sampling and crop planning for reviewed reframes. */

import type { VideoClipCompositionCrop } from '../video-clip-composition.ts';

export const ASSISTANCE_REFRAME_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_REFRAME_SAMPLES_PER_SECOND = 2 as const;

const MAXIMUM_SAMPLES = 200_000;
const MAXIMUM_SHOT_ANCHORS = 100_000;
const MAXIMUM_SUBJECTS_PER_SAMPLE = 256;
const MINIMUM_TARGET_ASPECT = 0.1;
const MAXIMUM_TARGET_ASPECT = 10;
const MINIMUM_SUBJECT_CONFIDENCE = 0.25;
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;

const SAMPLE_REQUEST_FIELDS = Object.freeze([
	'sourceStartFrame', 'sourceEndFrame', 'timescale', 'shotAnchorFrames',
] as const);
const PATH_REQUEST_FIELDS = Object.freeze(['sourceSize', 'targetAspect', 'samples'] as const);
const DIMENSION_FIELDS = Object.freeze(['width', 'height'] as const);
const SAMPLE_FIELDS = Object.freeze(['sourceFrame', 'subjects', 'saliency'] as const);
const SUBJECT_FIELDS = Object.freeze(['trackId', 'kind', 'confidence', 'box'] as const);
const BOX_FIELDS = Object.freeze(['x', 'y', 'width', 'height'] as const);
const SALIENCY_FIELDS = Object.freeze(['x', 'y', 'score'] as const);

export interface AssistanceReframeDimensionsV1 {
	readonly width: number;
	readonly height: number;
}

export interface AssistanceReframeSampleRequestV1 {
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	/** Source-frame ticks per second; VFR callers obtain these from source-time authority. */
	readonly timescale: number;
	readonly shotAnchorFrames: readonly number[];
}

export interface AssistanceReframeNormalizedBoxV1 {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export type AssistanceReframeSubjectKindV1 = 'face' | 'object';

export interface AssistanceReframeSubjectV1 {
	readonly trackId: string;
	readonly kind: AssistanceReframeSubjectKindV1;
	readonly confidence: number;
	readonly box: AssistanceReframeNormalizedBoxV1;
}

export interface AssistanceReframeSaliencyV1 {
	readonly x: number;
	readonly y: number;
	readonly score: number;
}

export interface AssistanceReframeSampleV1 {
	readonly sourceFrame: number;
	readonly subjects: readonly AssistanceReframeSubjectV1[];
	readonly saliency: AssistanceReframeSaliencyV1 | null;
}

export interface AssistanceReframePathRequestV1 {
	readonly sourceSize: AssistanceReframeDimensionsV1;
	readonly targetAspect: AssistanceReframeDimensionsV1;
	readonly samples: readonly AssistanceReframeSampleV1[];
}

export type AssistanceReframeCropAuthorityV1 = 'subject' | 'saliency' | 'center';

export interface AssistanceReframeKeyframeV1 {
	readonly schemaVersion: typeof ASSISTANCE_REFRAME_SCHEMA_VERSION;
	readonly sourceFrame: number;
	readonly authority: AssistanceReframeCropAuthorityV1;
	readonly trackIds: readonly string[];
	readonly crop: VideoClipCompositionCrop;
}

/** Union a fixed two-samples-per-second cadence with exact, source-authoritative shot anchors. */
export function collectAssistanceReframeSampleFramesV1(
	value: AssistanceReframeSampleRequestV1,
): readonly number[] {
	const request = exactRecord(value, SAMPLE_REQUEST_FIELDS, 'reframe sample request');
	const start = integer(request.sourceStartFrame, 0, Number.MAX_SAFE_INTEGER,
		'reframe source start frame');
	const end = integer(request.sourceEndFrame, 1, Number.MAX_SAFE_INTEGER,
		'reframe source end frame');
	if (end <= start) throw new RangeError('The reframe source range must have positive duration.');
	const timescale = integer(request.timescale, 1, Number.MAX_SAFE_INTEGER,
		'reframe source timescale');
	const duration = end - start;
	const cadenceCount = Math.ceil(duration * ASSISTANCE_REFRAME_SAMPLES_PER_SECOND / timescale);
	if (!Number.isSafeInteger(cadenceCount) || cadenceCount > MAXIMUM_SAMPLES) {
		throw new RangeError('The reframe sample inventory exceeds its bound.');
	}
	const anchors = request.shotAnchorFrames;
	if (!Array.isArray(anchors) || anchors.length > MAXIMUM_SHOT_ANCHORS) {
		throw new RangeError('The reframe shot-anchor inventory exceeds its bound.');
	}
	const frames = new Set<number>();
	for (let ordinal = 0; ordinal < cadenceCount; ordinal += 1) {
		const offset = Math.floor(ordinal * timescale / ASSISTANCE_REFRAME_SAMPLES_PER_SECOND);
		const sourceFrame = start + offset;
		if (!Number.isSafeInteger(sourceFrame)) {
			throw new RangeError('The reframe sample cadence overflowed source timing.');
		}
		if (sourceFrame < end) frames.add(sourceFrame);
	}
	for (const [index, candidate] of anchors.entries()) {
		const sourceFrame = integer(candidate, start, end - 1,
			`reframe shot anchor ${String(index)}`);
		frames.add(sourceFrame);
	}
	return Object.freeze([...frames].sort((left, right) => left - right));
}

/** Plan a bounded crop at every tracked sample, preferring subjects over saliency over center. */
export function planAssistanceReframePathV1(
	value: AssistanceReframePathRequestV1,
): readonly AssistanceReframeKeyframeV1[] {
	const request = exactRecord(value, PATH_REQUEST_FIELDS, 'reframe path request');
	const sourceSize = dimensions(request.sourceSize, 'reframe source size');
	const targetAspect = dimensions(request.targetAspect, 'reframe target aspect');
	const targetRatio = targetAspect.width / targetAspect.height;
	if (targetRatio < MINIMUM_TARGET_ASPECT || targetRatio > MAXIMUM_TARGET_ASPECT) {
		throw new RangeError('The reframe target aspect is outside its bounded range.');
	}
	if (!Array.isArray(request.samples) || request.samples.length < 1
		|| request.samples.length > MAXIMUM_SAMPLES) {
		throw new RangeError('The reframe path requires a bounded, non-empty sample inventory.');
	}

	let priorFrame = -1;
	const keyframes = request.samples.map((candidate, index) => {
		const sample = exactRecord(candidate, SAMPLE_FIELDS, `reframe sample ${String(index)}`);
		const sourceFrame = integer(sample.sourceFrame, 0, Number.MAX_SAFE_INTEGER,
			`reframe sample ${String(index)} source frame`);
		if (sourceFrame <= priorFrame) throw new RangeError('Reframe samples must be strictly ordered.');
		priorFrame = sourceFrame;
		const subjects = normalizeSubjects(sample.subjects, index);
		const saliency = normalizeSaliency(sample.saliency, index);
		const eligible = subjects.filter(({ confidence }) => confidence >= MINIMUM_SUBJECT_CONFIDENCE);
		const trackIds = Object.freeze(eligible.map(({ trackId }) => trackId).sort());
		let authority: AssistanceReframeCropAuthorityV1;
		let focus: Readonly<{ x: number; y: number }>;
		if (eligible.length > 0) {
			authority = 'subject';
			focus = subjectFocus(eligible);
		} else if (saliency !== null && saliency.score > 0) {
			authority = 'saliency';
			focus = saliency;
		} else {
			authority = 'center';
			focus = CENTER;
		}
		return Object.freeze({
			schemaVersion: ASSISTANCE_REFRAME_SCHEMA_VERSION,
			sourceFrame,
			authority,
			trackIds,
			crop: cropAtFocus(sourceSize, targetRatio, focus),
		});
	});
	return Object.freeze(keyframes);
}

/** Resolve a preview crop between reviewed keyframes without extrapolating past either end. */
export function interpolateAssistanceReframeCropV1(
	pathValue: readonly AssistanceReframeKeyframeV1[],
	sourceFrameValue: number,
): VideoClipCompositionCrop {
	if (!Array.isArray(pathValue) || pathValue.length < 1 || pathValue.length > MAXIMUM_SAMPLES) {
		throw new RangeError('The reframe interpolation path is invalid.');
	}
	const sourceFrame = integer(sourceFrameValue, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
		'reframe interpolation source frame');
	let priorFrame = -1;
	const path = pathValue.map((candidate, index) => {
		if (!candidate || candidate.schemaVersion !== ASSISTANCE_REFRAME_SCHEMA_VERSION) {
			throw new RangeError(`Reframe keyframe ${String(index)} has an unsupported schema.`);
		}
		const frame = integer(candidate.sourceFrame, 0, Number.MAX_SAFE_INTEGER,
			`reframe keyframe ${String(index)} source frame`);
		if (frame <= priorFrame) throw new RangeError('Reframe keyframes must be strictly ordered.');
		priorFrame = frame;
		return Object.freeze({ sourceFrame: frame, crop: normalizeCrop(candidate.crop, index) });
	});
	if (sourceFrame <= path[0]!.sourceFrame) return path[0]!.crop;
	const last = path[path.length - 1]!;
	if (sourceFrame >= last.sourceFrame) return last.crop;
	const rightIndex = path.findIndex(({ sourceFrame: frame }) => frame >= sourceFrame);
	const left = path[rightIndex - 1]!;
	const right = path[rightIndex]!;
	const weight = (sourceFrame - left.sourceFrame) / (right.sourceFrame - left.sourceFrame);
	return Object.freeze({
		left: mix(left.crop.left, right.crop.left, weight),
		top: mix(left.crop.top, right.crop.top, weight),
		right: mix(left.crop.right, right.crop.right, weight),
		bottom: mix(left.crop.bottom, right.crop.bottom, weight),
	});
}

const CENTER = Object.freeze({ x: 0.5, y: 0.5 });

function normalizeSubjects(value: unknown, sampleIndex: number): readonly AssistanceReframeSubjectV1[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_SUBJECTS_PER_SAMPLE) {
		throw new RangeError(`Reframe sample ${String(sampleIndex)} has too many subjects.`);
	}
	const seen = new Set<string>();
	return Object.freeze(value.map((candidate, subjectIndex) => {
		const label = `reframe sample ${String(sampleIndex)} subject ${String(subjectIndex)}`;
		const record = exactRecord(candidate, SUBJECT_FIELDS, label);
		const trackId = stableId(record.trackId, `${label} track ID`);
		if (seen.has(trackId)) throw new TypeError(`${label} duplicates a track ID.`);
		seen.add(trackId);
		if (record.kind !== 'face' && record.kind !== 'object') {
			throw new TypeError(`${label} has an unsupported kind.`);
		}
		return Object.freeze({
			trackId,
			kind: record.kind,
			confidence: unit(record.confidence, `${label} confidence`),
			box: normalizedBox(record.box, `${label} box`),
		});
	}));
}

function normalizeSaliency(value: unknown, sampleIndex: number): AssistanceReframeSaliencyV1 | null {
	if (value === null) return null;
	const label = `reframe sample ${String(sampleIndex)} saliency`;
	const record = exactRecord(value, SALIENCY_FIELDS, label);
	return Object.freeze({
		x: unit(record.x, `${label} x`),
		y: unit(record.y, `${label} y`),
		score: unit(record.score, `${label} score`),
	});
}

function subjectFocus(subjects: readonly AssistanceReframeSubjectV1[]): Readonly<{ x: number; y: number }> {
	let totalWeight = 0;
	let x = 0;
	let y = 0;
	for (const subject of subjects) {
		const weight = subject.confidence * Math.sqrt(subject.box.width * subject.box.height)
			* (subject.kind === 'face' ? 1.25 : 1);
		totalWeight += weight;
		x += (subject.box.x + subject.box.width / 2) * weight;
		y += (subject.box.y + subject.box.height / 2) * weight;
	}
	if (!(totalWeight > 0)) return CENTER;
	return Object.freeze({ x: x / totalWeight, y: y / totalWeight });
}

function cropAtFocus(
	sourceSize: AssistanceReframeDimensionsV1,
	targetRatio: number,
	focus: Readonly<{ x: number; y: number }>,
): VideoClipCompositionCrop {
	const sourceRatio = sourceSize.width / sourceSize.height;
	const width = targetRatio < sourceRatio ? targetRatio / sourceRatio : 1;
	const height = targetRatio < sourceRatio ? 1 : sourceRatio / targetRatio;
	const left = clamp(focus.x - width / 2, 0, 1 - width);
	const top = clamp(focus.y - height / 2, 0, 1 - height);
	return Object.freeze({
		left: canonicalUnit(left),
		top: canonicalUnit(top),
		right: canonicalUnit(1 - left - width),
		bottom: canonicalUnit(1 - top - height),
	});
}

function normalizeCrop(value: unknown, index: number): VideoClipCompositionCrop {
	const record = exactRecord(value, ['left', 'top', 'right', 'bottom'] as const,
		`reframe keyframe ${String(index)} crop`);
	const crop = Object.freeze({
		left: unit(record.left, 'reframe crop left'),
		top: unit(record.top, 'reframe crop top'),
		right: unit(record.right, 'reframe crop right'),
		bottom: unit(record.bottom, 'reframe crop bottom'),
	});
	if (crop.left + crop.right >= 1 || crop.top + crop.bottom >= 1) {
		throw new RangeError('The reframe crop must retain positive area.');
	}
	return crop;
}

function normalizedBox(value: unknown, label: string): AssistanceReframeNormalizedBoxV1 {
	const record = exactRecord(value, BOX_FIELDS, label);
	const box = Object.freeze({
		x: unit(record.x, `${label} x`),
		y: unit(record.y, `${label} y`),
		width: positiveUnit(record.width, `${label} width`),
		height: positiveUnit(record.height, `${label} height`),
	});
	if (box.x + box.width > 1 || box.y + box.height > 1) {
		throw new RangeError(`The ${label} must remain inside the source frame.`);
	}
	return box;
}

function dimensions(value: unknown, label: string): AssistanceReframeDimensionsV1 {
	const record = exactRecord(value, DIMENSION_FIELDS, label);
	return Object.freeze({
		width: integer(record.width, 1, 65_535, `${label} width`),
		height: integer(record.height, 1, 65_535, `${label} height`),
	});
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} has unsupported fields.`);
	}
	return record as Record<Field, unknown>;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and between zero and one.`);
	}
	return value;
}

function positiveUnit(value: unknown, label: string): number {
	const result = unit(value, label);
	if (result === 0) throw new RangeError(`The ${label} must be positive.`);
	return result;
}

function canonicalUnit(value: number): number {
	if (Math.abs(value) < Number.EPSILON) return 0;
	if (Math.abs(1 - value) < Number.EPSILON) return 1;
	return Math.round(value * 1e15) / 1e15;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function mix(left: number, right: number, weight: number): number {
	return canonicalUnit(left + (right - left) * weight);
}
