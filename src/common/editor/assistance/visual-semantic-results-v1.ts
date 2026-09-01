/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict VFR-bound semantic review for OCR, subjects, saliency, and reframes. */

export const ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION = 1 as const;

const MAXIMUM_FRAMES = 100_000;
const MAXIMUM_OCR_REGIONS_PER_FRAME = 512;
const MAXIMUM_SUBJECTS_PER_FRAME = 1_024;
const MAXIMUM_TIMESCALE = 0x7fff_ffff;
const MAXIMUM_SOURCE_FRAME = 0xffff_ffff;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const TICK = /^(?:0|[1-9]\d*)$/u;
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const NON_WHITESPACE = /[^\p{White_Space}]/u;

const RESULT_FIELDS = Object.freeze(['schemaVersion', 'width', 'height', 'timescale', 'frames']);
const AUTHORITY_FIELDS = Object.freeze(['width', 'height', 'timescale', 'frames']);
const AUTHORITY_FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick']);
const OCR_FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'regions']);
const OCR_REGION_FIELDS = Object.freeze(['text', 'confidence', 'box']);
const SUBJECT_FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'subjects']);
const SUBJECT_FIELDS = Object.freeze(['kind', 'classId', 'label', 'confidence', 'box']);
const SALIENCY_FRAME_FIELDS = Object.freeze(['sourceFrame', 'presentationTick', 'saliency']);
const SALIENCY_FIELDS = Object.freeze(['x', 'y', 'score']);
const BOX_FIELDS = Object.freeze(['x', 'y', 'width', 'height']);
const REFRAME_FIELDS = Object.freeze(['schemaVersion', 'targetAspect', 'keyframes']);
const ASPECT_FIELDS = Object.freeze(['width', 'height']);
const KEYFRAME_FIELDS = Object.freeze(['sourceFrame', 'authority', 'trackIds', 'crop']);
const CROP_FIELDS = Object.freeze(['left', 'top', 'right', 'bottom']);

export interface AssistanceVisualFrameAuthorityFrameV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
}

export interface AssistanceVisualFrameAuthorityV1 {
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frames: readonly AssistanceVisualFrameAuthorityFrameV1[];
}

export interface AssistanceVisualNormalizedBoxV1 {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface AssistanceOcrRegionV1 {
	readonly text: string;
	readonly confidence: number;
	readonly box: AssistanceVisualNormalizedBoxV1;
}

export interface AssistanceOcrFrameV1 extends AssistanceVisualFrameAuthorityFrameV1 {
	readonly regions: readonly AssistanceOcrRegionV1[];
}

export interface AssistanceOcrResultV1 {
	readonly schemaVersion: typeof ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION;
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frames: readonly AssistanceOcrFrameV1[];
}

export type AssistanceSubjectKindV1 = 'face' | 'person' | 'object';

export interface AssistanceSubjectDetectionV1 {
	readonly kind: AssistanceSubjectKindV1;
	readonly classId: number | null;
	readonly label: string;
	readonly confidence: number;
	readonly box: AssistanceVisualNormalizedBoxV1;
}

export interface AssistanceSubjectFrameV1 extends AssistanceVisualFrameAuthorityFrameV1 {
	readonly subjects: readonly AssistanceSubjectDetectionV1[];
}

export interface AssistanceSubjectResultV1 extends Omit<AssistanceOcrResultV1, 'frames'> {
	readonly frames: readonly AssistanceSubjectFrameV1[];
}

export interface AssistanceSaliencyPointV1 {
	readonly x: number;
	readonly y: number;
	readonly score: number;
}

export interface AssistanceSaliencyFrameV1 extends AssistanceVisualFrameAuthorityFrameV1 {
	readonly saliency: AssistanceSaliencyPointV1 | null;
}

export interface AssistanceSaliencyResultV1 extends Omit<AssistanceOcrResultV1, 'frames'> {
	readonly frames: readonly AssistanceSaliencyFrameV1[];
}

export interface AssistanceReframePathKeyframeV1 {
	readonly sourceFrame: number;
	readonly authority: 'subject' | 'saliency' | 'center';
	readonly trackIds: readonly string[];
	readonly crop: Readonly<{ left: number; top: number; right: number; bottom: number }>;
}

export interface AssistanceReframePathResultV1 {
	readonly schemaVersion: typeof ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION;
	readonly targetAspect: Readonly<{ width: number; height: number }>;
	readonly keyframes: readonly AssistanceReframePathKeyframeV1[];
}

export function reviewAssistanceOcrResultV1(
	value: unknown,
	authorityValue: unknown,
): AssistanceOcrResultV1 {
	const { record, authority } = visualResult(value, authorityValue);
	const frames = authority.frames.map((expected, index): AssistanceOcrFrameV1 => {
		const row = boundFrame(record.frames[index], OCR_FRAME_FIELDS, expected, index, 'OCR');
		const regions = boundedArray(row.regions, MAXIMUM_OCR_REGIONS_PER_FRAME,
			`OCR frame ${String(index)} regions`).map((candidate, regionIndex) => {
			const label = `OCR frame ${String(index)} region ${String(regionIndex)}`;
			const region = exactRecord(candidate, OCR_REGION_FIELDS, label);
			return Object.freeze({
				text: boundedText(region.text, 2_048, `${label} text`),
				confidence: unit(region.confidence, `${label} confidence`),
				box: normalizedBox(region.box, `${label} box`),
			});
		});
		return Object.freeze({ ...expected, regions: Object.freeze(regions) });
	});
	return result(authority, frames);
}

export function reviewAssistanceSubjectResultV1(
	value: unknown,
	authorityValue: unknown,
): AssistanceSubjectResultV1 {
	const { record, authority } = visualResult(value, authorityValue);
	const frames = authority.frames.map((expected, index): AssistanceSubjectFrameV1 => {
		const row = boundFrame(record.frames[index], SUBJECT_FRAME_FIELDS, expected, index, 'subject');
		const subjects = boundedArray(row.subjects, MAXIMUM_SUBJECTS_PER_FRAME,
			`subject frame ${String(index)} inventory`).map((candidate, subjectIndex) => {
			const label = `subject frame ${String(index)} detection ${String(subjectIndex)}`;
			const subject = exactRecord(candidate, SUBJECT_FIELDS, label);
			if (subject.kind !== 'face' && subject.kind !== 'person' && subject.kind !== 'object') {
				throw new TypeError(`The ${label} kind is unsupported.`);
			}
			const classId = subject.classId === null ? null
				: integer(subject.classId, 0, 9_999, `${label} class ID`);
			const labelText = boundedText(subject.label, 160, `${label} label`);
			if (subject.kind === 'face' && (classId !== null || labelText !== 'face')) {
				throw new TypeError('A face detection cannot carry biometric identity or an object class.');
			}
			return Object.freeze({
				kind: subject.kind,
				classId,
				label: labelText,
				confidence: unit(subject.confidence, `${label} confidence`),
				box: normalizedBox(subject.box, `${label} box`),
			});
		});
		return Object.freeze({ ...expected, subjects: Object.freeze(subjects) });
	});
	return result(authority, frames);
}

export function reviewAssistanceSaliencyResultV1(
	value: unknown,
	authorityValue: unknown,
): AssistanceSaliencyResultV1 {
	const { record, authority } = visualResult(value, authorityValue);
	const frames = authority.frames.map((expected, index): AssistanceSaliencyFrameV1 => {
		const row = boundFrame(record.frames[index], SALIENCY_FRAME_FIELDS, expected, index, 'saliency');
		let saliency: AssistanceSaliencyPointV1 | null = null;
		if (row.saliency !== null) {
			const label = `saliency frame ${String(index)}`;
			const point = exactRecord(row.saliency, SALIENCY_FIELDS, label);
			saliency = Object.freeze({
				x: unit(point.x, `${label} x`),
				y: unit(point.y, `${label} y`),
				score: unit(point.score, `${label} score`),
			});
		}
		return Object.freeze({ ...expected, saliency });
	});
	return result(authority, frames);
}

export function reviewAssistanceReframePathResultV1(
	value: unknown,
	authorityValue: unknown,
): AssistanceReframePathResultV1 {
	const authority = visualAuthority(authorityValue);
	const row = exactRecord(value, REFRAME_FIELDS, 'reframe-path result');
	if (row.schemaVersion !== ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION) {
		throw new TypeError('The reframe-path schema version is unsupported.');
	}
	const aspectRecord = exactRecord(row.targetAspect, ASPECT_FIELDS, 'reframe target aspect');
	const targetAspect = Object.freeze({
		width: integer(aspectRecord.width, 1, 65_535, 'reframe target width'),
		height: integer(aspectRecord.height, 1, 65_535, 'reframe target height'),
	});
	const ratio = targetAspect.width / targetAspect.height;
	if (ratio < 0.1 || ratio > 10) throw new RangeError('The reframe target aspect is out of range.');
	const candidates = boundedArray(row.keyframes, MAXIMUM_FRAMES, 'reframe keyframes');
	if (candidates.length !== authority.frames.length) {
		throw new RangeError('A reframe path must bind every sampled frame in its authority.');
	}
	const keyframes = candidates.map((candidate, index): AssistanceReframePathKeyframeV1 => {
		const label = `reframe keyframe ${String(index)}`;
		const keyframe = exactRecord(candidate, KEYFRAME_FIELDS, label);
		const expectedFrame = authority.frames[index]!.sourceFrame;
		if (keyframe.sourceFrame !== expectedFrame) {
			throw new RangeError(`${label} disagrees with its sampled frame authority.`);
		}
		if (keyframe.authority !== 'subject' && keyframe.authority !== 'saliency'
			&& keyframe.authority !== 'center') {
			throw new TypeError(`${label} has an unsupported crop authority.`);
		}
		const trackValues = boundedArray(keyframe.trackIds, 256, `${label} track IDs`);
		const trackIds = trackValues.map((trackId, trackIndex) =>
			stableId(trackId, `${label} track ID ${String(trackIndex)}`));
		if (trackIds.some((trackId, trackIndex) => trackIndex > 0
			&& trackId <= trackIds[trackIndex - 1]!)) {
			throw new TypeError(`${label} track IDs must be sorted and unique.`);
		}
		if ((keyframe.authority === 'subject') !== (trackIds.length > 0)) {
			throw new TypeError(`${label} subject authority must name its exact tracks.`);
		}
		return Object.freeze({
			sourceFrame: expectedFrame,
			authority: keyframe.authority,
			trackIds: Object.freeze(trackIds),
			crop: crop(keyframe.crop, label),
		});
	});
	return Object.freeze({ schemaVersion: ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION,
		targetAspect, keyframes: Object.freeze(keyframes) });
}

function visualResult(value: unknown, authorityValue: unknown): Readonly<{
	record: Readonly<Record<string, unknown>> & { readonly frames: readonly unknown[] };
	authority: AssistanceVisualFrameAuthorityV1;
}> {
	const authority = visualAuthority(authorityValue);
	const record = exactRecord(value, RESULT_FIELDS, 'visual semantic result');
	if (record.schemaVersion !== ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION
		|| record.width !== authority.width || record.height !== authority.height
		|| record.timescale !== authority.timescale) {
		throw new RangeError('The visual semantic result disagrees with its frame geometry authority.');
	}
	const frames = boundedArray(record.frames, MAXIMUM_FRAMES, 'visual semantic frame inventory');
	if (frames.length !== authority.frames.length) {
		throw new RangeError('A visual semantic result must bind every frame in its authority.');
	}
	return Object.freeze({ record: Object.freeze({ ...record, frames }), authority });
}

function visualAuthority(value: unknown): AssistanceVisualFrameAuthorityV1 {
	const record = exactRecord(value, AUTHORITY_FIELDS, 'visual frame authority');
	const width = integer(record.width, 1, 4_096, 'visual frame width');
	const height = integer(record.height, 1, 4_096, 'visual frame height');
	const timescale = integer(record.timescale, 1, MAXIMUM_TIMESCALE, 'visual frame timescale');
	const values = boundedArray(record.frames, MAXIMUM_FRAMES, 'visual frame authority inventory');
	let priorSourceFrame = -1;
	let priorTick = -1n;
	const frames = values.map((candidate, index) => {
		const frame = exactRecord(candidate, AUTHORITY_FRAME_FIELDS,
			`visual frame authority ${String(index)}`);
		const sourceFrame = integer(frame.sourceFrame, 0, MAXIMUM_SOURCE_FRAME,
			`visual frame authority ${String(index)} source frame`);
		const presentationTick = tick(frame.presentationTick,
			`visual frame authority ${String(index)} presentation tick`);
		if (sourceFrame <= priorSourceFrame || BigInt(presentationTick) <= priorTick) {
			throw new RangeError('Visual frame authority must be strictly ordered in both domains.');
		}
		priorSourceFrame = sourceFrame;
		priorTick = BigInt(presentationTick);
		return Object.freeze({ sourceFrame, presentationTick });
	});
	return Object.freeze({ width, height, timescale, frames: Object.freeze(frames) });
}

function boundFrame(
	value: unknown,
	fields: readonly string[],
	expected: AssistanceVisualFrameAuthorityFrameV1,
	index: number,
	label: string,
): Readonly<Record<string, unknown>> {
	const row = exactRecord(value, fields, `${label} frame ${String(index)}`);
	if (row.sourceFrame !== expected.sourceFrame || row.presentationTick !== expected.presentationTick) {
		throw new RangeError(`The ${label} frame timing disagrees with its exact authority.`);
	}
	return row;
}

function result<Frame extends AssistanceVisualFrameAuthorityFrameV1>(
	authority: AssistanceVisualFrameAuthorityV1,
	frames: readonly Frame[],
): Readonly<Omit<AssistanceOcrResultV1, 'frames'> & { readonly frames: readonly Frame[] }> {
	return Object.freeze({ schemaVersion: ASSISTANCE_VISUAL_RESULT_SCHEMA_VERSION,
		width: authority.width, height: authority.height, timescale: authority.timescale,
		frames: Object.freeze(frames) });
}

function normalizedBox(value: unknown, label: string): AssistanceVisualNormalizedBoxV1 {
	const row = exactRecord(value, BOX_FIELDS, label);
	const box = Object.freeze({ x: unit(row.x, `${label} x`), y: unit(row.y, `${label} y`),
		width: positiveUnit(row.width, `${label} width`),
		height: positiveUnit(row.height, `${label} height`) });
	if (box.x + box.width > 1 || box.y + box.height > 1) {
		throw new RangeError(`The ${label} escapes the normalized frame.`);
	}
	return box;
}

function crop(value: unknown, label: string): AssistanceReframePathKeyframeV1['crop'] {
	const row = exactRecord(value, CROP_FIELDS, `${label} crop`);
	const result = Object.freeze({ left: unit(row.left, `${label} crop left`),
		top: unit(row.top, `${label} crop top`), right: unit(row.right, `${label} crop right`),
		bottom: unit(row.bottom, `${label} crop bottom`) });
	if (result.left + result.right >= 1 || result.top + result.bottom >= 1) {
		throw new RangeError('A reframe crop must retain positive area.');
	}
	return result;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record;
}

function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum) {
		throw new RangeError(`The ${label} exceeds its exact bound.`);
	}
	return value;
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || !NON_WHITESPACE.test(value) || value.length > maximum
		|| CONTROL.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function tick(value: unknown, label: string): string {
	if (typeof value !== 'string' || !TICK.test(value) || BigInt(value) > MAXIMUM_TICK) {
		throw new RangeError(`The ${label} is noncanonical.`);
	}
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
