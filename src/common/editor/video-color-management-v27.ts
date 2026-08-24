/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Renderer-neutral managed-SDR color authority for the selected Framescaper
 * finishing route. Persisted values name interpretations and transforms; raw
 * pixels, LUT bodies, histograms, and scopes remain transient.
 */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	requireCubeLutBody,
	sampleCubeLut,
	VIDEO_COLOR_LIMITS_V1,
	type ParsedCubeLutV1,
	type VideoCubeLutReferenceV1,
} from './video-color-cube-lut-v27.ts';

export {
	parseCubeLutV1,
	VIDEO_COLOR_LIMITS_V1,
	type ParsedCubeLutV1,
	type VideoCubeLutReferenceV1,
} from './video-color-cube-lut-v27.ts';

export type VideoSourceColorPrimariesV1 = 'srgb' | 'bt709' | 'display-p3' | 'bt2020' | 'unknown';
export type VideoSourceColorTransferV1 = 'srgb' | 'bt709' | 'pq' | 'hlg' | 'unknown';
export type VideoSourceColorMatrixV1 = 'rgb' | 'bt709' | 'bt2020-ncl' | 'unknown';
export type VideoColorOutputSpaceV1 = 'linear-rec709-d65' | 'srgb' | 'rec709';
export type RgbTripletV1 = readonly [number, number, number];
export type LinearRgbaV1 = readonly [number, number, number, number];

export interface VideoColorContextV1 {
	readonly schemaVersion: 1;
	readonly sequenceId: string;
	readonly workingSpace: 'linear-rec709-d65';
	readonly outputSpace: 'srgb' | 'rec709';
	readonly alphaMode: 'straight-authored-premultiplied-working';
	readonly toneMapping: 'none';
}

export interface VideoSourceColorInterpretationV1 {
	readonly schemaVersion: 1;
	readonly sourceId: string;
	readonly sourceKind: 'still' | 'video';
	readonly primaries: VideoSourceColorPrimariesV1;
	readonly transfer: VideoSourceColorTransferV1;
	readonly matrix: VideoSourceColorMatrixV1;
	readonly range: 'full' | 'limited' | 'unknown';
	readonly provenance:
		| 'metadata'
		| 'default-still-srgb-full'
		| 'default-video-bt709-limited'
		| 'user-override'
		| 'legacy-unmanaged-encoded';
}

export interface VideoColorGradeV1 {
	readonly schemaVersion: 1;
	readonly exposureStops: number;
	readonly contrast: number;
	readonly pivot: number;
	readonly lift: RgbTripletV1;
	readonly gamma: RgbTripletV1;
	readonly gain: RgbTripletV1;
	readonly saturation: number;
	readonly lut: VideoCubeLutReferenceV1 | null;
}

type ManagedSdrInterpretationV1 = VideoSourceColorInterpretationV1 & Readonly<{
	readonly primaries: 'srgb' | 'bt709';
	readonly transfer: 'srgb' | 'bt709';
	readonly matrix: 'rgb' | 'bt709';
	readonly range: 'full' | 'limited';
}>;

const CONTEXT_FIELDS = Object.freeze([
	'schemaVersion', 'sequenceId', 'workingSpace', 'outputSpace', 'alphaMode', 'toneMapping',
]);
const INTERPRETATION_FIELDS = Object.freeze([
	'schemaVersion', 'sourceId', 'sourceKind', 'primaries', 'transfer', 'matrix', 'range',
	'provenance',
]);
const GRADE_FIELDS = Object.freeze([
	'schemaVersion', 'exposureStops', 'contrast', 'pivot', 'lift', 'gamma', 'gain',
	'saturation', 'lut',
]);
const LUT_FIELDS = Object.freeze([
	'storageKey', 'sha256', 'byteLength', 'size', 'domainMin', 'domainMax',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function defaultVideoSourceColorInterpretationV1(
	kind: 'still' | 'video',
	sourceId: string,
): VideoSourceColorInterpretationV1 {
	const id = stableId(sourceId, 'color source ID');
	return kind === 'still' ? Object.freeze({
		schemaVersion: 1 as const,
		sourceId: id,
		sourceKind: 'still' as const,
		primaries: 'srgb' as const,
		transfer: 'srgb' as const,
		matrix: 'rgb' as const,
		range: 'full' as const,
		provenance: 'default-still-srgb-full' as const,
	}) : Object.freeze({
		schemaVersion: 1 as const,
		sourceId: id,
		sourceKind: 'video' as const,
		primaries: 'bt709' as const,
		transfer: 'bt709' as const,
		matrix: 'bt709' as const,
		range: 'limited' as const,
		provenance: 'default-video-bt709-limited' as const,
	});
}

export function normalizeVideoColorContextV1(value: unknown): VideoColorContextV1 {
	const record = readClosedDomainRecord(value, 'video color context', CONTEXT_FIELDS);
	exact(field(record, 'schemaVersion', 'video color context'), 1, 'video color context schema');
	return Object.freeze({
		schemaVersion: 1 as const,
		sequenceId: stableId(field(record, 'sequenceId', 'video color context'), 'color sequence ID'),
		workingSpace: exact(field(record, 'workingSpace', 'video color context'), 'linear-rec709-d65', 'working space'),
		outputSpace: oneOf(field(record, 'outputSpace', 'video color context'), ['srgb', 'rec709'] as const, 'color output space'),
		alphaMode: exact(field(record, 'alphaMode', 'video color context'), 'straight-authored-premultiplied-working', 'color alpha mode'),
		toneMapping: exact(field(record, 'toneMapping', 'video color context'), 'none', 'color tone mapping'),
	});
}

export function normalizeVideoSourceColorInterpretationV1(
	value: unknown,
): VideoSourceColorInterpretationV1 {
	const name = 'video source color interpretation';
	const record = readClosedDomainRecord(value, name, INTERPRETATION_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	const sourceKind = oneOf(field(record, 'sourceKind', name), ['still', 'video'] as const, 'color source kind');
	const result = Object.freeze({
		schemaVersion: 1 as const,
		sourceId: stableId(field(record, 'sourceId', name), 'color source ID'),
		sourceKind,
		primaries: oneOf(field(record, 'primaries', name), ['srgb', 'bt709', 'display-p3', 'bt2020', 'unknown'] as const, 'color primaries'),
		transfer: oneOf(field(record, 'transfer', name), ['srgb', 'bt709', 'pq', 'hlg', 'unknown'] as const, 'color transfer'),
		matrix: oneOf(field(record, 'matrix', name), ['rgb', 'bt709', 'bt2020-ncl', 'unknown'] as const, 'color matrix'),
		range: oneOf(field(record, 'range', name), ['full', 'limited', 'unknown'] as const, 'color range'),
		provenance: oneOf(field(record, 'provenance', name), [
			'metadata', 'default-still-srgb-full', 'default-video-bt709-limited',
			'user-override', 'legacy-unmanaged-encoded',
		] as const, 'color interpretation provenance'),
	});
	assertDefaultDisclosure(result);
	return result;
}

export function normalizeVideoColorGradeV1(value: unknown = defaultGrade()): VideoColorGradeV1 {
	const name = 'video color grade';
	const record = readClosedDomainRecord(value, name, GRADE_FIELDS);
	exact(field(record, 'schemaVersion', name), 1, `${name} schema`);
	return Object.freeze({
		schemaVersion: 1 as const,
		exposureStops: bounded(field(record, 'exposureStops', name), -12, 12, 'grade exposure'),
		contrast: bounded(field(record, 'contrast', name), 0, 4, 'grade contrast'),
		pivot: bounded(field(record, 'pivot', name), 0, 1, 'grade pivot'),
		lift: triplet(field(record, 'lift', name), -2, 2, 'grade lift'),
		gamma: triplet(field(record, 'gamma', name), 0.01, 10, 'grade gamma'),
		gain: triplet(field(record, 'gain', name), 0, 16, 'grade gain'),
		saturation: bounded(field(record, 'saturation', name), 0, 4, 'grade saturation'),
		lut: field(record, 'lut', name) === null
			? null : normalizeCubeLutReference(field(record, 'lut', name)),
	});
}

export function applyManagedSdrGradePixelV1(request: Readonly<{
	readonly rgba: readonly number[];
	readonly interpretation: unknown;
	readonly grade?: unknown;
	readonly lut?: ParsedCubeLutV1;
	readonly outputSpace: VideoColorOutputSpaceV1;
}>): LinearRgbaV1 {
	return applyManagedSdrGradeStackPixelV1({
		rgba: request?.rgba,
		interpretation: request?.interpretation,
		grades: [request?.grade],
		luts: [request?.lut],
		outputSpace: request?.outputSpace,
	});
}

/** Decode once, apply an ordered grade stack in the named working space, then encode once. */
export function applyManagedSdrGradeStackPixelV1(request: Readonly<{
	readonly rgba: readonly number[];
	readonly interpretation: unknown;
	readonly grades: readonly unknown[];
	readonly luts?: readonly (ParsedCubeLutV1 | undefined)[];
	readonly outputSpace: VideoColorOutputSpaceV1;
}>): LinearRgbaV1 {
	const linear = applyManagedSdrGradeStackLinearPixelV1(request);
	return encodeManagedSdrLinearPixelV1(linear, request.outputSpace);
}

/** Decode and grade into straight-alpha linear Rec.709/D65 without encoding. */
export function applyManagedSdrGradeStackLinearPixelV1(request: Readonly<{
	readonly rgba: readonly number[];
	readonly interpretation: unknown;
	readonly grades: readonly unknown[];
	readonly luts?: readonly (ParsedCubeLutV1 | undefined)[];
}>): LinearRgbaV1 {
	const interpretation = normalizeVideoSourceColorInterpretationV1(request?.interpretation);
	assertManagedSdr(interpretation);
	const rgba = rgbaTuple(request?.rgba);
	const encoded = [rgba[0], rgba[1], rgba[2]].map((channel) => (
		interpretation.range === 'limited' ? limitedToFull(channel) : channel
	));
	return applyManagedSdrLinearGradeStackPixelV1({
		rgba: [
			decodeTransfer(encoded[0]!, interpretation.transfer),
			decodeTransfer(encoded[1]!, interpretation.transfer),
			decodeTransfer(encoded[2]!, interpretation.transfer),
			rgba[3],
		],
		grades: request.grades,
		...(request.luts === undefined ? {} : { luts: request.luts }),
	});
}

/**
 * Decode and grade one canvas-readback pixel into straight-alpha linear
 * Rec.709/D65 without encoding.
 *
 * getImageData and WebGL readback return pixels in the canvas colour space —
 * full-range, sRGB-encoded — whatever the source file's tags say, because the
 * browser already applied the file interpretation (range expansion and
 * transfer conversion) while drawing the media. Decoding readback bytes with
 * the file tuple would apply that conversion a second time, crushing shadows
 * below the limited-range floor and clipping highlights above it. The
 * persisted file interpretation therefore gates ADMISSION here — HDR and
 * wide-gamut identity still refuse rather than silently tone-map — while the
 * pixels decode as what the readback actually produced.
 */
export function applyManagedSdrCanvasReadbackGradeStackLinearPixelV1(request: Readonly<{
	readonly rgba: readonly number[];
	readonly interpretation: unknown;
	readonly grades: readonly unknown[];
	readonly luts?: readonly (ParsedCubeLutV1 | undefined)[];
}>): LinearRgbaV1 {
	const interpretation = normalizeVideoSourceColorInterpretationV1(request?.interpretation);
	assertManagedSdr(interpretation);
	const rgba = rgbaTuple(request?.rgba);
	return applyManagedSdrLinearGradeStackPixelV1({
		rgba: [
			decodeTransfer(rgba[0], 'srgb'),
			decodeTransfer(rgba[1], 'srgb'),
			decodeTransfer(rgba[2], 'srgb'),
			rgba[3],
		],
		grades: request.grades,
		...(request.luts === undefined ? {} : { luts: request.luts }),
	});
}

/** Apply grades to an already-decoded straight-alpha linear working pixel. */
export function applyManagedSdrLinearGradeStackPixelV1(request: Readonly<{
	readonly rgba: readonly number[];
	readonly grades: readonly unknown[];
	readonly luts?: readonly (ParsedCubeLutV1 | undefined)[];
}>): LinearRgbaV1 {
	if (!Array.isArray(request?.grades) || request.grades.length > 64) {
		throw new RangeError('The managed SDR grade stack exceeds its bound.');
	}
	if (request.luts !== undefined && (!Array.isArray(request.luts)
		|| request.luts.length !== request.grades.length)) {
		throw new RangeError('The managed SDR grade stack LUT bodies must align with its grades.');
	}
	const grades = request.grades.map((value, index) => {
		const grade = normalizeVideoColorGradeV1(value);
		const lut = grade.lut === null ? null
			: requireCubeLutBody(grade.lut, request.luts?.[index]);
		return Object.freeze({ grade, lut });
	});
	const rgba = rgbaTuple(request?.rgba);
	let linear = [rgba[0], rgba[1], rgba[2]];
	for (const { grade, lut } of grades) linear = applyGrade(linear, grade, lut);
	return Object.freeze([clamp(linear[0]!), clamp(linear[1]!), clamp(linear[2]!), rgba[3]]);
}

/** Decode one output-space-encoded pixel back into straight linear Rec.709/D65. */
export function decodeManagedSdrOutputPixelV1(
	rgbaValue: readonly number[],
	outputSpace: VideoColorOutputSpaceV1,
): LinearRgbaV1 {
	const rgba = rgbaTuple(rgbaValue);
	if (outputSpace === 'linear-rec709-d65') return rgba;
	if (outputSpace !== 'srgb' && outputSpace !== 'rec709') {
		throw new RangeError('The managed SDR output space is unsupported.');
	}
	const transfer = outputSpace === 'srgb' ? 'srgb' as const : 'bt709' as const;
	return Object.freeze([
		decodeTransfer(rgba[0], transfer),
		decodeTransfer(rgba[1], transfer),
		decodeTransfer(rgba[2], transfer),
		rgba[3],
	]);
}

/** Encode one straight-alpha linear working pixel exactly once. */
export function encodeManagedSdrLinearPixelV1(
	rgbaValue: readonly number[],
	outputSpace: VideoColorOutputSpaceV1,
): LinearRgbaV1 {
	const rgba = rgbaTuple(rgbaValue);
	return Object.freeze([
		encodeOutput(rgba[0], outputSpace),
		encodeOutput(rgba[1], outputSpace),
		encodeOutput(rgba[2], outputSpace),
		rgba[3],
	]);
}

function applyGrade(
	linearValue: readonly number[],
	grade: VideoColorGradeV1,
	lut: ParsedCubeLutV1 | null,
): number[] {
	const exposure = 2 ** grade.exposureStops;
	let linear = linearValue.map((channel, index) => {
		const contrasted = (channel * exposure - grade.pivot) * grade.contrast + grade.pivot;
		const lifted = Math.max(0, contrasted + grade.lift[index]!);
		return Math.pow(lifted * grade.gain[index]!, 1 / grade.gamma[index]!);
	});
	const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
	linear = linear.map((channel) => luminance + (channel - luminance) * grade.saturation);
	return lut ? sampleCubeLut(lut, linear) : linear;
}

function defaultGrade(): VideoColorGradeV1 {
	return Object.freeze({
		schemaVersion: 1,
		exposureStops: 0,
		contrast: 1,
		pivot: 0.18,
		lift: Object.freeze([0, 0, 0]) as RgbTripletV1,
		gamma: Object.freeze([1, 1, 1]) as RgbTripletV1,
		gain: Object.freeze([1, 1, 1]) as RgbTripletV1,
		saturation: 1,
		lut: null,
	});
}

function normalizeCubeLutReference(value: unknown): VideoCubeLutReferenceV1 {
	const record = readClosedDomainRecord(value, 'video cube LUT reference', LUT_FIELDS);
	const digest = sha(field(record, 'sha256', 'video cube LUT reference'), 'cube LUT digest');
	const storageKey = field(record, 'storageKey', 'video cube LUT reference');
	if (storageKey !== `lut-sha256:${digest}`) throw new TypeError('The cube LUT storage key must bind its SHA-256.');
	const result = Object.freeze({
		storageKey,
		sha256: digest,
		byteLength: boundedInteger(field(record, 'byteLength', 'video cube LUT reference'), 1, VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes, 'cube LUT bytes'),
		size: boundedInteger(field(record, 'size', 'video cube LUT reference'), 2, VIDEO_COLOR_LIMITS_V1.maximumCubeLutSize, 'cube LUT size'),
		domainMin: triplet(field(record, 'domainMin', 'video cube LUT reference'), -65_536, 65_536, 'cube LUT domain minimum'),
		domainMax: triplet(field(record, 'domainMax', 'video cube LUT reference'), -65_536, 65_536, 'cube LUT domain maximum'),
	});
	if (result.domainMin.some((channel, index) => channel >= result.domainMax[index]!)) {
		throw new RangeError('The cube LUT reference domain minimum must precede its maximum.');
	}
	return result;
}

function assertDefaultDisclosure(value: VideoSourceColorInterpretationV1): void {
	if (value.provenance === 'default-still-srgb-full' && (
		value.sourceKind !== 'still' || value.primaries !== 'srgb' || value.transfer !== 'srgb'
		|| value.matrix !== 'rgb' || value.range !== 'full'
	)) throw new RangeError('The default still color disclosure must mean sRGB full-range.');
	if (value.provenance === 'default-video-bt709-limited' && (
		value.sourceKind !== 'video' || value.primaries !== 'bt709' || value.transfer !== 'bt709'
		|| value.matrix !== 'bt709' || value.range !== 'limited'
	)) throw new RangeError('The default video color disclosure must mean BT.709 limited-range.');
}

function assertManagedSdr(
	value: VideoSourceColorInterpretationV1,
): asserts value is ManagedSdrInterpretationV1 {
	assertManagedVideoColorRenderAdmissionV1(value);
}

/** Shared fail-closed admission used before managed preview and export processing. */
export function assertManagedVideoColorRenderAdmissionV1(
	value: VideoSourceColorInterpretationV1,
): asserts value is ManagedSdrInterpretationV1 {
	if (value.provenance === 'legacy-unmanaged-encoded') {
		throw new RangeError(
			'Managed video rendering refuses a legacy unmanaged source; choose an explicit source color interpretation before preview or export.',
		);
	}
	const primaries = value.primaries === 'srgb' || value.primaries === 'bt709';
	const transfer = value.transfer === 'srgb' || value.transfer === 'bt709';
	const matrix = value.matrix === 'rgb' || value.matrix === 'bt709';
	const range = value.range === 'full' || value.range === 'limited';
	if (!primaries || !transfer || !matrix || !range) {
		throw new RangeError(
			'Managed video rendering refuses an HDR or wide-gamut source interpretation without an exact transform.',
		);
	}
}

function rgbaTuple(value: unknown): LinearRgbaV1 {
	const array = readClosedDomainArray(value, 'managed SDR RGBA pixel', 4, 4);
	return Object.freeze(array.map((channel, index) => bounded(
		channel, 0, 1, `managed SDR RGBA channel ${String(index)}`,
	)) as unknown as [number, number, number, number]);
}

function decodeTransfer(value: number, transfer: 'srgb' | 'bt709'): number {
	const channel = clamp(value);
	if (transfer === 'srgb') return channel <= 0.04045
		? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	return channel < 0.081 ? channel / 4.5 : ((channel + 0.099) / 1.099) ** (1 / 0.45);
}

function encodeOutput(value: number, output: VideoColorOutputSpaceV1): number {
	if (output === 'linear-rec709-d65') return value;
	if (output === 'srgb') return value <= 0.0031308
		? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
	if (output === 'rec709') return value < 0.018
		? value * 4.5 : 1.099 * value ** 0.45 - 0.099;
	throw new RangeError('The managed SDR output space is unsupported.');
}

function limitedToFull(value: number): number {
	return clamp((value - 16 / 255) / (219 / 255));
}

function triplet(value: unknown, minimum: number, maximum: number, name: string): RgbTripletV1 {
	const array = readClosedDomainArray(value, name, 3, 3);
	return Object.freeze(array.map((item, index) => bounded(
		item, minimum, maximum, `${name}[${String(index)}]`,
	)) as unknown as [number, number, number]);
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function exact<const Value extends string | number>(value: unknown, expected: Value, name: string): Value {
	if (value !== expected) throw new RangeError(`${name} is unsupported.`);
	return expected;
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Values[number];
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function sha(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a finite number other than negative zero.`);
	}
	return value;
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	const result = finite(value, name);
	if (result < minimum || result > maximum) throw new RangeError(`${name} is outside its bound.`);
	return result;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
	if (!Number.isSafeInteger(number) || Number(number) < minimum || Number(number) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(number);
}

function clamp(value: number): number {
	return clampUnit(value);
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}
