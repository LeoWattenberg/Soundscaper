/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import type { Rational } from './timeline-time.ts';

export const VIDEO_VISUAL_MODEL_LIMITS_V1 = Object.freeze({
	maximumDimension: 65_536,
	maximumFrameCount: 2_000_000,
	maximumTextLength: 16_384,
	maximumExternalInputs: 64,
	maximumAdjustmentTargets: 256,
	maximumAdjustmentEffects: 4_096,
});

export interface VideoStillSourceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'still';
	readonly id: string;
	readonly name: string;
	readonly mimeType: string;
	readonly storageKey: string;
	readonly contentSha256: string;
	readonly width: number;
	readonly height: number;
	readonly hasAlpha: boolean;
}

export interface VideoStillClipV1 {
	readonly schemaVersion: 1;
	readonly kind: 'still';
	readonly id: string;
	readonly sourceId: string;
	readonly sequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
}

export interface VideoGeneratorTextDocumentV1 {
	readonly kind: 'title' | 'text';
	readonly text: string;
	readonly fontFamily: 'soundscaper-sans' | 'soundscaper-serif' | 'soundscaper-mono';
	readonly fontSize: number;
	readonly color: string;
	readonly horizontalAlign: 'start' | 'center' | 'end';
	readonly verticalAlign: 'start' | 'middle' | 'end';
}

export interface VideoGeneratorShapeDocumentV1 {
	readonly kind: 'shape';
	readonly shape: 'rectangle' | 'ellipse' | 'line';
	readonly fillColor: string | null;
	readonly strokeColor: string | null;
	readonly strokeWidth: number;
}

export interface VideoGeneratorSolidDocumentV1 {
	readonly kind: 'solid';
	readonly color: string;
}

export interface VideoGeneratorExternalInputV1 {
	readonly name: string;
	readonly sourceRef: string;
}

export interface VideoExternalGeneratorDocumentV1 {
	readonly kind: 'external-generator';
	readonly bindingId: string;
	readonly inputs: readonly VideoGeneratorExternalInputV1[];
}

export type VideoGeneratorDocumentV1 =
	| VideoGeneratorTextDocumentV1
	| VideoGeneratorShapeDocumentV1
	| VideoGeneratorSolidDocumentV1
	| VideoExternalGeneratorDocumentV1;

export interface VideoGeneratorSourceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'generator';
	readonly id: string;
	readonly name: string;
	readonly width: number;
	readonly height: number;
	readonly frameRate: Rational;
	readonly frameCount: number;
	readonly generator: VideoGeneratorDocumentV1;
}

export interface VideoGeneratorClipV1 {
	readonly schemaVersion: 1;
	readonly kind: 'generator';
	readonly id: string;
	readonly sourceId: string;
	readonly sequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
}

export interface VideoAdjustmentLayerV1 {
	readonly schemaVersion: 1;
	readonly kind: 'adjustment-layer';
	readonly id: string;
	readonly sequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly targetTrackIds: readonly string[];
	readonly effectIds: readonly string[];
}

const STILL_SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256',
	'width', 'height', 'hasAlpha',
]);
const STILL_CLIP_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'sourceId', 'sequenceId', 'sequenceStartFrame',
	'sequenceFrameCount',
]);
const GENERATOR_SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'name', 'width', 'height', 'frameRate', 'frameCount',
	'generator',
]);
const GENERATOR_CLIP_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'sourceId', 'sequenceId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceInFrame', 'sourceFrameCount',
]);
const ADJUSTMENT_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'sequenceId', 'sequenceStartFrame',
	'sequenceFrameCount', 'targetTrackIds', 'effectIds',
]);
const TEXT_FIELDS = Object.freeze([
	'kind', 'text', 'fontFamily', 'fontSize', 'color', 'horizontalAlign', 'verticalAlign',
]);
const SHAPE_FIELDS = Object.freeze([
	'kind', 'shape', 'fillColor', 'strokeColor', 'strokeWidth',
]);
const SOLID_FIELDS = Object.freeze(['kind', 'color']);
const EXTERNAL_FIELDS = Object.freeze(['kind', 'bindingId', 'inputs']);
const EXTERNAL_INPUT_FIELDS = Object.freeze(['name', 'sourceRef']);
const RATE_FIELDS = Object.freeze(['num', 'den']);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const INPUT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COLOR = /^#[a-f0-9]{8}$/u;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeVideoStillSourceV1(value: unknown): VideoStillSourceV1 {
	const record = exact(value, 'video still source', STILL_SOURCE_FIELDS, 1, 'still');
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'still' as const,
		id: stableId(field(record, 'id', 'video still source'), 'video still source.id'),
		name: safeText(field(record, 'name', 'video still source'), 'video still source.name', 512, false),
		mimeType: imageMime(field(record, 'mimeType', 'video still source'), 'video still source'),
		storageKey: stableId(field(record, 'storageKey', 'video still source'), 'video still source.storageKey'),
		contentSha256: digest(field(record, 'contentSha256', 'video still source'), 'video still source'),
		width: dimension(field(record, 'width', 'video still source'), 'video still source.width'),
		height: dimension(field(record, 'height', 'video still source'), 'video still source.height'),
		hasAlpha: boolean(field(record, 'hasAlpha', 'video still source'), 'video still source.hasAlpha'),
	});
}

export function normalizeVideoStillClipV1(value: unknown): VideoStillClipV1 {
	const record = exact(value, 'video still clip', STILL_CLIP_FIELDS, 1, 'still');
	const range = timelineRange(record, 'video still clip');
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'still' as const,
		id: stableId(field(record, 'id', 'video still clip'), 'video still clip.id'),
		sourceId: stableId(field(record, 'sourceId', 'video still clip'), 'video still clip.sourceId'),
		sequenceId: stableId(field(record, 'sequenceId', 'video still clip'), 'video still clip.sequenceId'),
		...range,
	});
}

export function normalizeVideoGeneratorSourceV1(value: unknown): VideoGeneratorSourceV1 {
	const record = exact(value, 'video generator source', GENERATOR_SOURCE_FIELDS, 1, 'generator');
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'generator' as const,
		id: stableId(field(record, 'id', 'video generator source'), 'video generator source.id'),
		name: safeText(field(record, 'name', 'video generator source'), 'video generator source.name', 512, false),
		width: dimension(field(record, 'width', 'video generator source'), 'video generator source.width'),
		height: dimension(field(record, 'height', 'video generator source'), 'video generator source.height'),
		frameRate: frameRate(field(record, 'frameRate', 'video generator source')),
		frameCount: boundedPositiveInteger(field(record, 'frameCount', 'video generator source'), VIDEO_VISUAL_MODEL_LIMITS_V1.maximumFrameCount, 'video generator source.frameCount'),
		generator: generatorDocument(field(record, 'generator', 'video generator source')),
	});
}

export function normalizeVideoGeneratorClipV1(value: unknown): VideoGeneratorClipV1 {
	const record = exact(value, 'video generator clip', GENERATOR_CLIP_FIELDS, 1, 'generator');
	const range = timelineRange(record, 'video generator clip');
	const sourceInFrame = nonNegativeSafeInteger(field(record, 'sourceInFrame', 'video generator clip'), 'video generator clip.sourceInFrame');
	const sourceFrameCount = boundedPositiveInteger(field(record, 'sourceFrameCount', 'video generator clip'), VIDEO_VISUAL_MODEL_LIMITS_V1.maximumFrameCount, 'video generator clip.sourceFrameCount');
	if (!Number.isSafeInteger(sourceInFrame + sourceFrameCount)) throw new RangeError('The video generator clip source range must end at a safe integer.');
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'generator' as const,
		id: stableId(field(record, 'id', 'video generator clip'), 'video generator clip.id'),
		sourceId: stableId(field(record, 'sourceId', 'video generator clip'), 'video generator clip.sourceId'),
		sequenceId: stableId(field(record, 'sequenceId', 'video generator clip'), 'video generator clip.sequenceId'),
		...range,
		sourceInFrame,
		sourceFrameCount,
	});
}

export function normalizeVideoAdjustmentLayerV1(value: unknown): VideoAdjustmentLayerV1 {
	const record = exact(value, 'video adjustment layer', ADJUSTMENT_FIELDS, 1, 'adjustment-layer');
	return Object.freeze({
		schemaVersion: 1 as const,
		kind: 'adjustment-layer' as const,
		id: stableId(field(record, 'id', 'video adjustment layer'), 'video adjustment layer.id'),
		sequenceId: stableId(field(record, 'sequenceId', 'video adjustment layer'), 'video adjustment layer.sequenceId'),
		...timelineRange(record, 'video adjustment layer'),
		targetTrackIds: idCollection(field(record, 'targetTrackIds', 'video adjustment layer'), 'video adjustment layer target tracks', 1, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumAdjustmentTargets),
		effectIds: idCollection(field(record, 'effectIds', 'video adjustment layer'), 'video adjustment layer effects', 0, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumAdjustmentEffects),
	});
}

function generatorDocument(value: unknown): VideoGeneratorDocumentV1 {
	const discriminant = readClosedDomainRecord(value, 'video generator document', [
		...new Set([...TEXT_FIELDS, ...SHAPE_FIELDS, ...SOLID_FIELDS, ...EXTERNAL_FIELDS]),
	], ['kind']);
	const kind = field(discriminant, 'kind', 'video generator document');
	if (kind === 'title' || kind === 'text') return textDocument(value, kind);
	if (kind === 'shape') return shapeDocument(value);
	if (kind === 'solid') return solidDocument(value);
	if (kind === 'external-generator') return externalDocument(value);
	throw new RangeError('video generator document.kind is unsupported.');
}

function textDocument(value: unknown, kind: 'title' | 'text'): VideoGeneratorTextDocumentV1 {
	const record = readClosedDomainRecord(value, `video ${kind} generator`, TEXT_FIELDS);
	return Object.freeze({
		kind,
		text: safeText(field(record, 'text', `video ${kind} generator`), `video ${kind} generator.text`, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumTextLength, true),
		fontFamily: oneOf(field(record, 'fontFamily', `video ${kind} generator`), ['soundscaper-sans', 'soundscaper-serif', 'soundscaper-mono'] as const, `video ${kind} generator font family`),
		fontSize: boundedFinite(field(record, 'fontSize', `video ${kind} generator`), 1, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumDimension, `video ${kind} generator.fontSize`),
		color: color(field(record, 'color', `video ${kind} generator`), `video ${kind} generator.color`),
		horizontalAlign: oneOf(field(record, 'horizontalAlign', `video ${kind} generator`), ['start', 'center', 'end'] as const, `video ${kind} generator.horizontalAlign`),
		verticalAlign: oneOf(field(record, 'verticalAlign', `video ${kind} generator`), ['start', 'middle', 'end'] as const, `video ${kind} generator.verticalAlign`),
	});
}

function shapeDocument(value: unknown): VideoGeneratorShapeDocumentV1 {
	const record = readClosedDomainRecord(value, 'video shape generator', SHAPE_FIELDS);
	const fillColor = optionalColor(field(record, 'fillColor', 'video shape generator'), 'video shape generator.fillColor');
	const strokeColor = optionalColor(field(record, 'strokeColor', 'video shape generator'), 'video shape generator.strokeColor');
	if (fillColor === null && strokeColor === null) throw new RangeError('A video shape requires a fill or stroke color.');
	return Object.freeze({
		kind: 'shape' as const,
		shape: oneOf(field(record, 'shape', 'video shape generator'), ['rectangle', 'ellipse', 'line'] as const, 'video shape generator.shape'),
		fillColor,
		strokeColor,
		strokeWidth: boundedFinite(field(record, 'strokeWidth', 'video shape generator'), 0, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumDimension, 'video shape generator.strokeWidth'),
	});
}

function solidDocument(value: unknown): VideoGeneratorSolidDocumentV1 {
	const record = readClosedDomainRecord(value, 'video solid generator', SOLID_FIELDS);
	return Object.freeze({ kind: 'solid' as const, color: color(field(record, 'color', 'video solid generator'), 'video solid generator.color') });
}

function externalDocument(value: unknown): VideoExternalGeneratorDocumentV1 {
	const record = readClosedDomainRecord(value, 'external video generator', EXTERNAL_FIELDS);
	const candidates = readClosedDomainArray(field(record, 'inputs', 'external video generator'), 'external video generator inputs', 0, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumExternalInputs);
	const seen = new Set<string>();
	const inputs = candidates.map((candidate, index) => {
		const name = `external video generator inputs[${String(index)}]`;
		const input = readClosedDomainRecord(candidate, name, EXTERNAL_INPUT_FIELDS);
		const normalizedName = inputName(field(input, 'name', name), `${name}.name`);
		if (seen.has(normalizedName)) throw new RangeError(`The external generator contains duplicate input ${normalizedName}.`);
		seen.add(normalizedName);
		return Object.freeze({ name: normalizedName, sourceRef: stableId(field(input, 'sourceRef', name), `${name}.sourceRef`) });
	});
	inputs.sort((left, right) => compareText(left.name, right.name));
	return Object.freeze({
		kind: 'external-generator' as const,
		bindingId: stableId(field(record, 'bindingId', 'external video generator'), 'external video generator.bindingId'),
		inputs: Object.freeze(inputs),
	});
}

function exact(value: unknown, name: string, fields: readonly string[], schemaVersion: number, kind: string): ClosedDomainRecord {
	const record = readClosedDomainRecord(value, name, fields);
	if (field(record, 'schemaVersion', name) !== schemaVersion) throw new RangeError(`${name}.schemaVersion must be ${String(schemaVersion)}.`);
	if (field(record, 'kind', name) !== kind) throw new RangeError(`${name}.kind must be ${kind}.`);
	return record;
}

function timelineRange(record: ClosedDomainRecord, name: string): Readonly<{ sequenceStartFrame: number; sequenceFrameCount: number }> {
	const sequenceStartFrame = nonNegativeSafeInteger(field(record, 'sequenceStartFrame', name), `${name}.sequenceStartFrame`);
	const sequenceFrameCount = boundedPositiveInteger(field(record, 'sequenceFrameCount', name), VIDEO_VISUAL_MODEL_LIMITS_V1.maximumFrameCount, `${name}.sequenceFrameCount`);
	if (!Number.isSafeInteger(sequenceStartFrame + sequenceFrameCount)) throw new RangeError(`The ${name} sequence range must end at a safe integer.`);
	return Object.freeze({ sequenceStartFrame, sequenceFrameCount });
}

function frameRate(value: unknown): Rational {
	const record = readClosedDomainRecord(value, 'video generator source.frameRate', RATE_FIELDS);
	const num = boundedPositiveInteger(field(record, 'num', 'frame rate'), Number.MAX_SAFE_INTEGER, 'frame rate.num');
	const den = boundedPositiveInteger(field(record, 'den', 'frame rate'), 1_000_000, 'frame rate.den');
	if (greatestCommonDivisor(num, den) !== 1) throw new RangeError('The video generator frame rate must be canonical and reduced.');
	if (BigInt(num) > BigInt(den) * 1_000n) throw new RangeError('The video generator frame rate may not exceed 1000 frames per second.');
	return Object.freeze({ num, den });
}

function idCollection(value: unknown, name: string, minimum: number, maximum: number): readonly string[] {
	const candidates = readClosedDomainArray(value, name, minimum, maximum);
	const seen = new Set<string>();
	const result = candidates.map((candidate, index) => {
		const id = stableId(candidate, `${name}[${String(index)}]`);
		if (seen.has(id)) throw new RangeError(`${name} contains duplicate ID ${id}.`);
		seen.add(id);
		return id;
	});
	result.sort(compareText);
	return Object.freeze(result);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function inputName(value: unknown, name: string): string {
	if (typeof value !== 'string' || !INPUT_NAME.test(value)) throw new TypeError(`${name} must be a canonical input name.`);
	return value;
}

function safeText(value: unknown, name: string, maximum: number, multiline: boolean): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.normalize('NFC') !== value || UNSAFE_TEXT.test(value) || (!multiline && /[\r\n]/u.test(value)) || /\r/u.test(value)) {
		throw new TypeError(`${name} must be canonical safe text without unsupported control characters.`);
	}
	return value;
}

function imageMime(value: unknown, name: string): string {
	if (typeof value !== 'string' || !IMAGE_MIME.test(value)) throw new TypeError(`${name}.mimeType must be a canonical image MIME type.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} digest must be lowercase SHA-256.`);
	return value;
}

function color(value: unknown, name: string): string {
	if (typeof value !== 'string' || !COLOR.test(value)) throw new TypeError(`${name} must be a lowercase #RRGGBBAA color.`);
	return value;
}

function optionalColor(value: unknown, name: string): string | null {
	return value === null ? null : color(value, name);
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function dimension(value: unknown, name: string): number {
	return boundedPositiveInteger(value, VIDEO_VISUAL_MODEL_LIMITS_V1.maximumDimension, name);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value as number;
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new RangeError(`${name} must be an integer from 1 through ${String(maximum)}.`);
	return value as number;
}

function boundedFinite(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) throw new RangeError(`${name} must be a finite number from ${String(minimum)} through ${String(maximum)}.`);
	return value;
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Values[number];
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = left;
	let b = right;
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}

function field(record: ClosedDomainRecord, name: string, owner: string): unknown {
	return readClosedDomainField(record, name, owner);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
