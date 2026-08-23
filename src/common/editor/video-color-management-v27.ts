/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Renderer-neutral managed-SDR color authority for the selected Framescaper
 * finishing route. Persisted values name interpretations and transforms; raw
 * pixels, LUT bodies, histograms, and scopes remain transient.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';

export const VIDEO_COLOR_LIMITS_V1 = Object.freeze({
	maximumCubeLutBytes: 16 * 1024 * 1024,
	maximumCubeLutSize: 64,
});

export type VideoSourceColorPrimariesV1 = 'srgb' | 'bt709' | 'display-p3' | 'bt2020';
export type VideoSourceColorTransferV1 = 'srgb' | 'bt709' | 'pq' | 'hlg';
export type VideoSourceColorMatrixV1 = 'rgb' | 'bt709' | 'bt2020-ncl';
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
	readonly range: 'full' | 'limited';
	readonly provenance:
		| 'metadata'
		| 'default-still-srgb-full'
		| 'default-video-bt709-limited'
		| 'user-override'
		| 'legacy-unmanaged-encoded';
}

export interface VideoCubeLutReferenceV1 {
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly size: number;
	readonly domainMin: RgbTripletV1;
	readonly domainMax: RgbTripletV1;
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

export interface ParsedCubeLutV1 {
	readonly title: string | null;
	readonly size: number;
	readonly domainMin: RgbTripletV1;
	readonly domainMax: RgbTripletV1;
	readonly values: readonly number[];
	readonly byteLength: number;
	readonly sha256: string;
}

type ManagedSdrInterpretationV1 = VideoSourceColorInterpretationV1 & Readonly<{
	readonly primaries: 'srgb' | 'bt709';
	readonly transfer: 'srgb' | 'bt709';
	readonly matrix: 'rgb' | 'bt709';
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
const UTF8 = new TextEncoder();
const PARSED_CUBE_LUTS = new WeakSet<object>();

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
		primaries: oneOf(field(record, 'primaries', name), ['srgb', 'bt709', 'display-p3', 'bt2020'] as const, 'color primaries'),
		transfer: oneOf(field(record, 'transfer', name), ['srgb', 'bt709', 'pq', 'hlg'] as const, 'color transfer'),
		matrix: oneOf(field(record, 'matrix', name), ['rgb', 'bt709', 'bt2020-ncl'] as const, 'color matrix'),
		range: oneOf(field(record, 'range', name), ['full', 'limited'] as const, 'color range'),
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
	const interpretation = normalizeVideoSourceColorInterpretationV1(request?.interpretation);
	assertManagedSdr(interpretation);
	const grade = normalizeVideoColorGradeV1(request?.grade);
	const lut = grade.lut === null ? null : requireCubeLutBody(grade.lut, request.lut);
	const rgba = rgbaTuple(request?.rgba);
	const encoded = [rgba[0], rgba[1], rgba[2]].map((channel) => (
		interpretation.range === 'limited' ? limitedToFull(channel) : channel
	));
	let linear = encoded.map((channel) => decodeTransfer(channel, interpretation.transfer));
	const exposure = 2 ** grade.exposureStops;
	linear = linear.map((channel, index) => {
		const contrasted = (channel * exposure - grade.pivot) * grade.contrast + grade.pivot;
		const lifted = Math.max(0, contrasted + grade.lift[index]!);
		return Math.pow(lifted * grade.gain[index]!, 1 / grade.gamma[index]!);
	});
	const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
	linear = linear.map((channel) => luminance + (channel - luminance) * grade.saturation);
	if (lut) linear = sampleCubeLut(lut, linear);
	const output = linear.map((channel) => encodeOutput(clamp(channel), request.outputSpace));
	return Object.freeze([
		output[0]! * rgba[3], output[1]! * rgba[3], output[2]! * rgba[3], rgba[3],
	]);
}

export function parseCubeLutV1(value: string): ParsedCubeLutV1 {
	if (typeof value !== 'string') throw new TypeError('A cube LUT body must be text.');
	const bytes = UTF8.encode(value);
	if (bytes.byteLength < 1 || bytes.byteLength > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) {
		throw new RangeError('The cube LUT body exceeds its byte bound.');
	}
	let title: string | null = null;
	let size: number | null = null;
	let domainMin: RgbTripletV1 = Object.freeze([0, 0, 0]);
	let domainMax: RgbTripletV1 = Object.freeze([1, 1, 1]);
	const values: number[] = [];
	for (const rawLine of value.split(/\r?\n/u)) {
		const line = rawLine.replace(/\s*#.*$/u, '').trim();
		if (!line) continue;
		if (/^TITLE\s/u.test(line)) {
			const match = /^TITLE\s+"([^"\r\n]{1,512})"$/u.exec(line);
			if (!match) throw new TypeError('The cube LUT title is invalid.');
			title = match[1]!;
			continue;
		}
		if (/^LUT_3D_SIZE\s/u.test(line)) {
			if (size !== null) throw new TypeError('The cube LUT declares its size more than once.');
			size = boundedInteger(token(line, 'LUT_3D_SIZE'), 2, VIDEO_COLOR_LIMITS_V1.maximumCubeLutSize, 'cube LUT size');
			continue;
		}
		if (/^DOMAIN_MIN\s/u.test(line)) {
			domainMin = numericLine(line, 'DOMAIN_MIN', 'cube LUT domain minimum');
			continue;
		}
		if (/^DOMAIN_MAX\s/u.test(line)) {
			domainMax = numericLine(line, 'DOMAIN_MAX', 'cube LUT domain maximum');
			continue;
		}
		if (/^[A-Z_]/u.test(line)) throw new RangeError('The cube LUT contains an unsupported directive.');
		values.push(...numericLine(line, null, 'cube LUT entry'));
	}
	if (size === null) throw new TypeError('The cube LUT requires LUT_3D_SIZE.');
	if (domainMin.some((channel, index) => channel >= domainMax[index]!)) {
		throw new RangeError('The cube LUT domain minimum must precede its maximum.');
	}
	const expected = size ** 3 * 3;
	if (values.length !== expected) {
		throw new RangeError(`The cube LUT entry count must be exactly ${String(expected)} scalars.`);
	}
	const parsed = Object.freeze({
		title,
		size,
		domainMin,
		domainMax,
		values: Object.freeze(values),
		byteLength: bytes.byteLength,
		sha256: bytesToHex(sha256(bytes)),
	});
	PARSED_CUBE_LUTS.add(parsed);
	return parsed;
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

function requireCubeLutBody(
	reference: VideoCubeLutReferenceV1,
	value: ParsedCubeLutV1 | undefined,
): ParsedCubeLutV1 {
	if (!value || typeof value !== 'object' || !PARSED_CUBE_LUTS.has(value)) {
		throw new TypeError('A grade with a LUT requires its verified transient cube LUT body.');
	}
	if (value.sha256 !== reference.sha256 || value.byteLength !== reference.byteLength
		|| value.size !== reference.size
		|| JSON.stringify(value.domainMin) !== JSON.stringify(reference.domainMin)
		|| JSON.stringify(value.domainMax) !== JSON.stringify(reference.domainMax)) {
		throw new RangeError('The transient cube LUT body does not match the persisted LUT digest and geometry.');
	}
	return value;
}

function sampleCubeLut(lut: ParsedCubeLutV1, input: readonly number[]): number[] {
	const axis = input.map((channel, index) => {
		const minimum = lut.domainMin[index]!;
		const maximum = lut.domainMax[index]!;
		const position = clampUnit((channel - minimum) / (maximum - minimum)) * (lut.size - 1);
		const low = Math.floor(position);
		return Object.freeze({ low, high: Math.min(lut.size - 1, low + 1), mix: position - low });
	});
	const output = [0, 0, 0];
	for (let channel = 0; channel < 3; channel += 1) {
		const c000 = lutValue(lut, axis[0]!.low, axis[1]!.low, axis[2]!.low, channel);
		const c001 = lutValue(lut, axis[0]!.low, axis[1]!.low, axis[2]!.high, channel);
		const c010 = lutValue(lut, axis[0]!.low, axis[1]!.high, axis[2]!.low, channel);
		const c011 = lutValue(lut, axis[0]!.low, axis[1]!.high, axis[2]!.high, channel);
		const c100 = lutValue(lut, axis[0]!.high, axis[1]!.low, axis[2]!.low, channel);
		const c101 = lutValue(lut, axis[0]!.high, axis[1]!.low, axis[2]!.high, channel);
		const c110 = lutValue(lut, axis[0]!.high, axis[1]!.high, axis[2]!.low, channel);
		const c111 = lutValue(lut, axis[0]!.high, axis[1]!.high, axis[2]!.high, channel);
		const z00 = mix(c000, c001, axis[2]!.mix);
		const z01 = mix(c010, c011, axis[2]!.mix);
		const z10 = mix(c100, c101, axis[2]!.mix);
		const z11 = mix(c110, c111, axis[2]!.mix);
		output[channel] = mix(
			mix(z00, z01, axis[1]!.mix),
			mix(z10, z11, axis[1]!.mix),
			axis[0]!.mix,
		);
	}
	return output;
}

function lutValue(
	lut: ParsedCubeLutV1,
	red: number,
	green: number,
	blue: number,
	channel: number,
): number {
	return lut.values[((red * lut.size + green) * lut.size + blue) * 3 + channel]!;
}

function mix(left: number, right: number, amount: number): number {
	return left + (right - left) * amount;
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
	const primaries = value.primaries === 'srgb' || value.primaries === 'bt709';
	const transfer = value.transfer === 'srgb' || value.transfer === 'bt709';
	const matrix = value.matrix === 'rgb' || value.matrix === 'bt709';
	if (!primaries || !transfer || !matrix) {
		throw new RangeError('Managed SDR grading requires an admitted SDR transform; HDR and wide-gamut identity are preserved without silent tone mapping.');
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

function numericLine(line: string, directive: string | null, name: string): RgbTripletV1 {
	const payload = directive === null ? line : line.slice(directive.length).trim();
	const parts = payload.split(/\s+/u);
	if (parts.length !== 3) throw new TypeError(`${name} requires exactly three scalars.`);
	return Object.freeze(parts.map((part, index) => finite(Number(part), `${name}[${String(index)}]`)) as [number, number, number]);
}

function token(line: string, directive: string): string {
	const parts = line.slice(directive.length).trim().split(/\s+/u);
	if (parts.length !== 1) throw new TypeError(`${directive} requires exactly one value.`);
	return parts[0]!;
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
