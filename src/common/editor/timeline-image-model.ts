/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import type { Rational } from './timeline-time.ts';

export const FRAMESCAPER_IMAGE_ASSET_MAGIC = 'FSCIAB01' as const;
export const FRAMESCAPER_IMAGE_ASSET_MIME_TYPE = 'application/vnd.framescaper.image-asset' as const;
export const FRAMESCAPER_IMAGE_TICKS_PER_SECOND = 1_000_000 as const;
export const FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 = Object.freeze({
	maximumAssetBytes: 512 * 1024 * 1024,
	maximumOriginalBytes: 64 * 1024 * 1024,
	maximumDimension: 8_192,
	maximumPixelsPerFrame: 16_777_216,
	maximumFrameCount: 4_096,
	maximumDurationTicks: 24 * 60 * 60 * FRAMESCAPER_IMAGE_TICKS_PER_SECOND,
	maximumSequenceFrameCount: 2_000_000,
});

export type FramescaperImageTimingModeV1 = 'embedded' | 'fallback' | 'mixed';

export interface FramescaperImageOriginalV1 {
	readonly fileName: string;
	readonly mimeType: string | null;
	readonly recognizedFormat: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperImageCanonicalV1 {
	readonly width: number;
	readonly height: number;
	readonly hasAlpha: boolean;
	readonly frameCount: number;
	readonly durationTicks: string;
	readonly timingMode: FramescaperImageTimingModeV1;
}

export interface FramescaperImageSourceV1 {
	readonly schemaVersion: 1;
	readonly kind: 'image';
	readonly id: string;
	readonly name: string;
	readonly mimeType: typeof FRAMESCAPER_IMAGE_ASSET_MIME_TYPE;
	readonly storageKey: string;
	readonly contentSha256: string;
	readonly assetByteLength: number;
	readonly original: FramescaperImageOriginalV1;
	readonly canonical: FramescaperImageCanonicalV1;
	readonly conversionReceiptSha256: string;
}

export interface FramescaperImageClipV1 {
	readonly schemaVersion: 1;
	readonly kind: 'image';
	readonly id: string;
	readonly sourceId: string;
	readonly sequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceStartTicks: string;
}

export interface FramescaperImageFrameTimingV1 {
	readonly presentationTicks: bigint;
	readonly durationTicks: bigint;
}

export interface FramescaperImageTimelineFrameMapRequestV1 {
	readonly clip: FramescaperImageClipV1;
	readonly sequenceFrame: number;
	readonly sequenceRate: Rational;
	readonly timings: readonly FramescaperImageFrameTimingV1[];
}

export interface FramescaperImageTimelineFrameMappingV1 {
	readonly sourceTicks: bigint;
	readonly frameIndex: number;
}

const SOURCE_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256',
	'assetByteLength', 'original', 'canonical', 'conversionReceiptSha256',
]);
const ORIGINAL_FIELDS = Object.freeze([
	'fileName', 'mimeType', 'recognizedFormat', 'byteLength', 'sha256',
]);
const CANONICAL_FIELDS = Object.freeze([
	'width', 'height', 'hasAlpha', 'frameCount', 'durationTicks', 'timingMode',
]);
const CLIP_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'id', 'sourceId', 'sequenceId', 'sequenceStartFrame',
	'sequenceFrameCount', 'sourceStartTicks',
]);
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const FORMAT = /^[a-z0-9][a-z0-9.+-]{0,63}$/u;
const DECIMAL_TICKS = /^(?:0|[1-9][0-9]{0,19})$/u;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeFramescaperImageSourceV1(value: unknown): FramescaperImageSourceV1 {
	const record = exact(value, 'Framescaper image source', SOURCE_FIELDS, 'image');
	const id = stableId(field(record, 'id', 'Framescaper image source'), 'Framescaper image source.id');
	const storageKey = stableId(
		field(record, 'storageKey', 'Framescaper image source'),
		'Framescaper image source.storageKey',
	);
	if (storageKey !== id) throw new TypeError('The Framescaper image storage key must equal its source id.');
	const mimeType = field(record, 'mimeType', 'Framescaper image source');
	if (mimeType !== FRAMESCAPER_IMAGE_ASSET_MIME_TYPE) {
		throw new TypeError('The Framescaper image source asset MIME is unsupported.');
	}
	const original = normalizeOriginal(field(record, 'original', 'Framescaper image source'));
	const canonical = normalizeCanonical(field(record, 'canonical', 'Framescaper image source'));
	const assetByteLength = positiveInteger(
		field(record, 'assetByteLength', 'Framescaper image source'),
		FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumAssetBytes,
		'Framescaper image source.assetByteLength',
	);
	if (assetByteLength <= original.byteLength) {
		throw new RangeError('The Framescaper image asset must contain more than its original section.');
	}
	return Object.freeze({
		schemaVersion: 1,
		kind: 'image',
		id,
		name: safeText(field(record, 'name', 'Framescaper image source'), 'Framescaper image source.name'),
		mimeType,
		storageKey,
		contentSha256: digest(field(record, 'contentSha256', 'Framescaper image source'), 'image asset'),
		assetByteLength,
		original,
		canonical,
		conversionReceiptSha256: digest(
			field(record, 'conversionReceiptSha256', 'Framescaper image source'),
			'image conversion receipt',
		),
	});
}

export function normalizeFramescaperImageClipV1(value: unknown): FramescaperImageClipV1 {
	const record = exact(value, 'Framescaper image clip', CLIP_FIELDS, 'image');
	const sequenceStartFrame = nonNegativeInteger(
		field(record, 'sequenceStartFrame', 'Framescaper image clip'),
		Number.MAX_SAFE_INTEGER,
		'Framescaper image clip.sequenceStartFrame',
	);
	const sequenceFrameCount = positiveInteger(
		field(record, 'sequenceFrameCount', 'Framescaper image clip'),
		FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumSequenceFrameCount,
		'Framescaper image clip.sequenceFrameCount',
	);
	if (!Number.isSafeInteger(sequenceStartFrame + sequenceFrameCount)) {
		throw new RangeError('The Framescaper image clip sequence range must end at a safe integer.');
	}
	return Object.freeze({
		schemaVersion: 1,
		kind: 'image',
		id: stableId(field(record, 'id', 'Framescaper image clip'), 'Framescaper image clip.id'),
		sourceId: stableId(
			field(record, 'sourceId', 'Framescaper image clip'), 'Framescaper image clip.sourceId',
		),
		sequenceId: stableId(
			field(record, 'sequenceId', 'Framescaper image clip'), 'Framescaper image clip.sequenceId',
		),
		sequenceStartFrame,
		sequenceFrameCount,
		sourceStartTicks: decimalTicks(
			field(record, 'sourceStartTicks', 'Framescaper image clip'),
			'Framescaper image clip source start ticks',
		),
	});
}

/** Map an active sequence frame to the canonical microsecond tick and coalesced image frame. */
export function mapFramescaperImageTimelineFrameV1(
	request: FramescaperImageTimelineFrameMapRequestV1,
): FramescaperImageTimelineFrameMappingV1 {
	const clip = normalizeFramescaperImageClipV1(request?.clip);
	const sequenceFrame = nonNegativeInteger(
		request?.sequenceFrame, Number.MAX_SAFE_INTEGER, 'Framescaper image sequence frame',
	);
	if (sequenceFrame < clip.sequenceStartFrame
		|| sequenceFrame >= clip.sequenceStartFrame + clip.sequenceFrameCount) {
		throw new RangeError('The requested sequence frame is outside the Framescaper image clip.');
	}
	const rate = normalizedRate(request?.sequenceRate);
	const timings = normalizedTimings(request?.timings);
	const localFrame = BigInt(sequenceFrame - clip.sequenceStartFrame);
	const sourceTicks = BigInt(clip.sourceStartTicks)
		+ localFrame * BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND) * BigInt(rate.den) / BigInt(rate.num);
	let low = 0;
	let high = timings.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (timings[middle]!.presentationTicks <= sourceTicks) low = middle + 1;
		else high = middle;
	}
	return Object.freeze({ sourceTicks, frameIndex: Math.max(0, Math.min(timings.length - 1, low - 1)) });
}

function normalizeOriginal(value: unknown): FramescaperImageOriginalV1 {
	const record = readClosedDomainRecord(value, 'Framescaper image original', ORIGINAL_FIELDS);
	const fileName = safeText(field(record, 'fileName', 'Framescaper image original'), 'image original file name');
	if (fileName === '.' || fileName === '..' || /[\\/]/u.test(fileName)) {
		throw new TypeError('The image original file name must be a path-free base name.');
	}
	const mimeValue = field(record, 'mimeType', 'Framescaper image original');
	if (mimeValue !== null && (typeof mimeValue !== 'string' || !MIME.test(mimeValue))) {
		throw new TypeError('The image original MIME hint must be null or a canonical MIME type.');
	}
	const recognizedFormat = field(record, 'recognizedFormat', 'Framescaper image original');
	if (typeof recognizedFormat !== 'string' || !FORMAT.test(recognizedFormat)) {
		throw new TypeError('The image original recognized format must be a canonical format token.');
	}
	return Object.freeze({
		fileName,
		mimeType: mimeValue,
		recognizedFormat,
		byteLength: positiveInteger(
			field(record, 'byteLength', 'Framescaper image original'),
			FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumOriginalBytes,
			'Framescaper image original.byteLength',
		),
		sha256: digest(field(record, 'sha256', 'Framescaper image original'), 'image original'),
	});
}

function normalizeCanonical(value: unknown): FramescaperImageCanonicalV1 {
	const record = readClosedDomainRecord(value, 'Framescaper canonical image', CANONICAL_FIELDS);
	const width = positiveInteger(
		field(record, 'width', 'Framescaper canonical image'),
		FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDimension,
		'Framescaper canonical image.width',
	);
	const height = positiveInteger(
		field(record, 'height', 'Framescaper canonical image'),
		FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDimension,
		'Framescaper canonical image.height',
	);
	if (width * height > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumPixelsPerFrame) {
		throw new RangeError('The Framescaper canonical image exceeds its pixel ceiling.');
	}
	const hasAlpha = field(record, 'hasAlpha', 'Framescaper canonical image');
	if (typeof hasAlpha !== 'boolean') throw new TypeError('Framescaper canonical image.hasAlpha must be boolean.');
	const timingMode = field(record, 'timingMode', 'Framescaper canonical image');
	if (timingMode !== 'embedded' && timingMode !== 'fallback' && timingMode !== 'mixed') {
		throw new RangeError('The Framescaper canonical image timing mode is unsupported.');
	}
	return Object.freeze({
		width,
		height,
		hasAlpha,
		frameCount: positiveInteger(
			field(record, 'frameCount', 'Framescaper canonical image'),
			FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumFrameCount,
			'Framescaper canonical image.frameCount',
		),
		durationTicks: decimalTicks(
			field(record, 'durationTicks', 'Framescaper canonical image'),
			'Framescaper canonical image duration',
			true,
		),
		timingMode,
	});
}

function normalizedTimings(value: unknown): readonly FramescaperImageFrameTimingV1[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumFrameCount) {
		throw new RangeError('Framescaper image timings require a bounded non-empty array.');
	}
	let end = 0n;
	const result = value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`Framescaper image timing ${String(index)} must be an object.`);
		}
		const timing = candidate as Record<string, unknown>;
		if (Reflect.ownKeys(timing).length !== 2
			|| !Object.hasOwn(timing, 'presentationTicks') || !Object.hasOwn(timing, 'durationTicks')) {
			throw new TypeError(`Framescaper image timing ${String(index)} has unsupported fields.`);
		}
		const presentationTicks = boundedBigInt(
			timing.presentationTicks, false, `Framescaper image timing ${String(index)} presentation`,
		);
		const durationTicks = boundedBigInt(
			timing.durationTicks, true, `Framescaper image timing ${String(index)} duration`,
		);
		if (presentationTicks !== end) throw new RangeError('Framescaper image timings must be continuous from zero.');
		end = presentationTicks + durationTicks;
		if (end > BigInt(FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDurationTicks)) {
			throw new RangeError('Framescaper image timings exceed the 24-hour duration ceiling.');
		}
		return Object.freeze({ presentationTicks, durationTicks });
	});
	return Object.freeze(result);
}

function normalizedRate(value: unknown): Rational {
	const record = readClosedDomainRecord(value, 'Framescaper image sequence rate', ['num', 'den']);
	const num = positiveInteger(field(record, 'num', 'sequence rate'), Number.MAX_SAFE_INTEGER, 'sequence rate.num');
	const den = positiveInteger(field(record, 'den', 'sequence rate'), 1_000_000, 'sequence rate.den');
	if (greatestCommonDivisor(num, den) !== 1) throw new RangeError('The Framescaper image sequence rate must be reduced.');
	if (BigInt(num) > BigInt(den) * 1_000n) throw new RangeError('The Framescaper image sequence rate exceeds 1000 fps.');
	return Object.freeze({ num, den });
}

function exact(
	value: unknown,
	name: string,
	fields: readonly string[],
	kind: 'image',
): ClosedDomainRecord {
	const record = readClosedDomainRecord(value, name, fields);
	if (field(record, 'schemaVersion', name) !== 1) throw new RangeError(`${name}.schemaVersion must be 1.`);
	if (field(record, 'kind', name) !== kind) throw new RangeError(`${name}.kind must be image.`);
	return record;
}

function field(record: ClosedDomainRecord, name: string, owner: string): unknown {
	return readClosedDomainField(record, name, owner);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function safeText(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 512
		|| value.normalize('NFC') !== value || UNSAFE_TEXT.test(value) || /[\r\n]/u.test(value)) {
		throw new TypeError(`${name} must be canonical safe text.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} digest must be lowercase SHA-256.`);
	return value;
}

function decimalTicks(value: unknown, name: string, positive = false): string {
	if (typeof value !== 'string' || !DECIMAL_TICKS.test(value)) throw new TypeError(`${name} ticks must be a canonical decimal string.`);
	const ticks = BigInt(value);
	if ((positive && ticks === 0n) || ticks > BigInt(FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDurationTicks)) {
		throw new RangeError(`${name} ticks are outside the 24-hour domain.`);
	}
	return value;
}

function boundedBigInt(value: unknown, positive: boolean, name: string): bigint {
	if (typeof value !== 'bigint' || value < (positive ? 1n : 0n)
		|| value > BigInt(FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDurationTicks)) {
		throw new RangeError(`${name} ticks are outside the 24-hour domain.`);
	}
	return value;
}

function positiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
		throw new RangeError(`${name} must be an integer from 1 through ${String(maximum)}.`);
	}
	return value as number;
}

function nonNegativeInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value as number;
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = left;
	let b = right;
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}
