/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_TIMING_ASSET_ENCODING = 'soundscaper-video-timing-v1';
export const VIDEO_TIMING_ASSET_MIME_TYPE = 'application/vnd.soundscaper.video-timing';
export const VIDEO_TIMING_ASSET_HEADER_BYTES = 32;
export const VIDEO_TIMING_ASSET_MAXIMUM_FRAMES = 2_000_000;
export const VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE = 0xffff_ffff;
export const VIDEO_TIMING_ASSET_MAXIMUM_BYTES = VIDEO_TIMING_ASSET_HEADER_BYTES
	+ VIDEO_TIMING_ASSET_MAXIMUM_FRAMES * BigInt64Array.BYTES_PER_ELEMENT;

const DIGEST = /^[a-f0-9]{64}$/u;
const STORAGE_PREFIX = 'video-timing-sha256:';

export interface VideoTimingAssetReference {
	readonly encoding: typeof VIDEO_TIMING_ASSET_ENCODING;
	readonly storageKey: string;
	readonly sha256: string;
	readonly sourceSha256: string;
	readonly byteLength: number;
	readonly frameCount: number;
	readonly timescale: number;
	readonly finalFrameDurationTicks: string;
}

/** Validate the persisted scalar reference without loading codec or hashing code. */
export function normalizeVideoTimingAssetReference(value: unknown): Readonly<VideoTimingAssetReference> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A timing asset reference is required.');
	}
	const candidate = value as Partial<VideoTimingAssetReference>;
	if (candidate.encoding !== VIDEO_TIMING_ASSET_ENCODING) {
		throw new RangeError('The timing asset encoding is unsupported.');
	}
	const sha = digest(candidate.sha256, 'timing asset');
	const storageKey = timingStorageKey(candidate.storageKey);
	if (storageKey !== `${STORAGE_PREFIX}${sha}`) {
		throw new Error('The timing asset storage key does not match its digest.');
	}
	const sourceSha256 = digest(candidate.sourceSha256, 'source content');
	const byteLength = positiveSafeInteger(candidate.byteLength, 'timing asset byteLength');
	if (byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
		throw new RangeError('The timing asset exceeds its byte limit.');
	}
	const frameCount = positiveSafeInteger(candidate.frameCount, 'timing asset frameCount');
	if (frameCount > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES
		|| byteLength !== VIDEO_TIMING_ASSET_HEADER_BYTES + frameCount * 8) {
		throw new RangeError('The timing asset summary is inconsistent.');
	}
	const timescale = positiveSafeInteger(candidate.timescale, 'timing asset timescale');
	if (timescale > VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE) {
		throw new RangeError('The timing asset timescale exceeds its unsigned 32-bit maximum.');
	}
	const finalFrameDurationTicks = positiveDecimalInt64(
		candidate.finalFrameDurationTicks,
		'timing asset final frame duration',
	);
	return Object.freeze({
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey,
		sha256: sha,
		sourceSha256,
		byteLength,
		frameCount,
		timescale,
		finalFrameDurationTicks,
	});
}

function timingStorageKey(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith(STORAGE_PREFIX)
		|| !DIGEST.test(value.slice(STORAGE_PREFIX.length))) {
		throw new TypeError('A digest-addressed timing asset storage key is required.');
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`A lowercase SHA-256 ${label} digest is required.`);
	}
	return value;
}

function positiveDecimalInt64(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
		throw new RangeError(`${name} must be a positive decimal integer.`);
	}
	const integer = BigInt(value);
	if (integer > 0x7fff_ffff_ffff_ffffn) {
		throw new RangeError(`${name} must be a positive signed 64-bit integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
