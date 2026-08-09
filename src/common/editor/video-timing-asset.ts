/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	normalizeVideoTimingAssetReference,
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

export {
	normalizeVideoTimingAssetReference,
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

const MAGIC = Uint8Array.of(0x53, 0x43, 0x54, 0x49);
const VERSION = 1;
const DIGEST = /^[a-f0-9]{64}$/u;
const STORAGE_PREFIX = 'video-timing-sha256:';

export interface VideoTimingAssetInput {
	readonly timescale: number;
	readonly presentationTicks: readonly bigint[];
	readonly finalFrameDurationTicks: bigint;
}

export interface VideoTimingIndex extends VideoTimingAssetInput {
	readonly encoding: typeof VIDEO_TIMING_ASSET_ENCODING;
	readonly frameCount: number;
	readonly endTicks: bigint;
}

export type VideoTimingAssetLoadResult = Readonly<{
	status: 'available' | 'missing' | 'corrupt' | 'source-mismatch';
	index: VideoTimingIndex | null;
}>;

export interface VideoTimingAssetPublication {
	readonly reference: Readonly<VideoTimingAssetReference>;
	readonly bytes: Uint8Array;
}

interface StoredTimingAsset {
	readonly bytes: Uint8Array;
	readonly generation: number;
}

export interface VideoTimingAssetReclaimOptions {
	readonly isReferenced: (storageKey: string) => PromiseLike<boolean> | boolean;
	readonly beforeDeleteFence?: () => PromiseLike<void> | void;
}

/** Encode normalized PTS ticks; adjacent deltas plus the explicit final duration own every frame extent. */
export function encodeVideoTimingAsset(input: VideoTimingAssetInput): Uint8Array {
	const timescale = positiveSafeInteger(input?.timescale, 'timing timescale');
	if (!Array.isArray(input?.presentationTicks)) throw new TypeError('Presentation ticks must be an array.');
	const frameCount = input.presentationTicks.length;
	if (frameCount < 1 || frameCount > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) {
		throw new RangeError(`A timing asset requires 1 through ${String(VIDEO_TIMING_ASSET_MAXIMUM_FRAMES)} frames.`);
	}
	const finalDuration = positiveInt64(input.finalFrameDurationTicks, 'final frame duration');
	const timestamps = input.presentationTicks.map((value, index) => int64(value, `presentationTicks[${String(index)}]`));
	if (timestamps[0] !== 0n) throw new RangeError('Canonical presentation ticks must begin at zero.');
	for (let index = 1; index < timestamps.length; index += 1) {
		if (timestamps[index] <= timestamps[index - 1]) {
			throw new RangeError('Presentation ticks must be strictly increasing.');
		}
	}
	positiveInt64(timestamps.at(-1)! + finalDuration, 'timing end');
	const byteLength = VIDEO_TIMING_ASSET_HEADER_BYTES + frameCount * BigInt64Array.BYTES_PER_ELEMENT;
	const bytes = new Uint8Array(byteLength);
	bytes.set(MAGIC, 0);
	const view = new DataView(bytes.buffer);
	view.setUint16(4, VERSION, true);
	view.setUint16(6, VIDEO_TIMING_ASSET_HEADER_BYTES, true);
	view.setUint32(8, timescale, true);
	view.setUint32(12, frameCount, true);
	view.setBigInt64(16, finalDuration, true);
	view.setBigUint64(24, 0n, true);
	for (let index = 0; index < timestamps.length; index += 1) {
		view.setBigInt64(VIDEO_TIMING_ASSET_HEADER_BYTES + index * 8, timestamps[index], true);
	}
	return bytes;
}

export function createVideoTimingAssetPublication(
	sourceSha256: string,
	input: VideoTimingAssetInput,
): VideoTimingAssetPublication {
	const sourceDigest = digest(sourceSha256, 'source content');
	const bytes = encodeVideoTimingAsset(input);
	const index = decodeVideoTimingAsset(bytes);
	const assetDigest = bytesToHex(sha256(bytes));
	return Object.freeze({
		reference: timingReference(sourceDigest, assetDigest, bytes.byteLength, index),
		bytes,
	});
}

export function decodeVideoTimingAsset(input: Uint8Array): VideoTimingIndex {
	if (!(input instanceof Uint8Array) || input.byteLength < VIDEO_TIMING_ASSET_HEADER_BYTES) {
		throw new RangeError('A complete timing asset header is required.');
	}
	if (!MAGIC.every((value, index) => input[index] === value)) throw new TypeError('The timing asset magic is invalid.');
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	if (view.getUint16(4, true) !== VERSION) throw new RangeError('The timing asset version is unsupported.');
	if (view.getUint16(6, true) !== VIDEO_TIMING_ASSET_HEADER_BYTES) throw new RangeError('The timing asset header length is invalid.');
	if (view.getBigUint64(24, true) !== 0n) throw new TypeError('The timing asset reserved header bytes must be zero.');
	const timescale = positiveSafeInteger(view.getUint32(8, true), 'timing timescale');
	const frameCount = positiveSafeInteger(view.getUint32(12, true), 'timing frame count');
	if (frameCount > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) throw new RangeError('The timing asset frame count exceeds its hard limit.');
	const expectedBytes = VIDEO_TIMING_ASSET_HEADER_BYTES + frameCount * 8;
	if (input.byteLength !== expectedBytes || input.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
		throw new RangeError('The timing asset length does not match its frame count.');
	}
	const finalFrameDurationTicks = positiveInt64(view.getBigInt64(16, true), 'final frame duration');
	const presentationTicks: bigint[] = [];
	for (let index = 0; index < frameCount; index += 1) {
		presentationTicks.push(view.getBigInt64(VIDEO_TIMING_ASSET_HEADER_BYTES + index * 8, true));
	}
	if (presentationTicks[0] !== 0n) throw new RangeError('Canonical presentation ticks must begin at zero.');
	for (let index = 1; index < presentationTicks.length; index += 1) {
		if (presentationTicks[index] <= presentationTicks[index - 1]) {
			throw new RangeError('Presentation ticks must be strictly increasing.');
		}
	}
	const endTicks = positiveInt64(presentationTicks.at(-1)! + finalFrameDurationTicks, 'timing end');
	return Object.freeze({
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		timescale,
		frameCount,
		presentationTicks: Object.freeze(presentationTicks),
		finalFrameDurationTicks,
		endTicks,
	});
}

/** Process-local contract implementation; durable adapters use the same immutable key/reference rules. */
export class VideoTimingAssetStore {
	readonly #records = new Map<string, StoredTimingAsset>();
	#generation = 0;

	async publish(sourceSha256: string, input: VideoTimingAssetInput): Promise<Readonly<VideoTimingAssetReference>> {
		const publication = createVideoTimingAssetPublication(sourceSha256, input);
		const { bytes, reference } = publication;
		const storageKey = reference.storageKey;
		const existing = this.#records.get(storageKey);
		if (existing && !equalBytes(existing.bytes, bytes)) {
			throw new Error('An immutable timing asset digest collision was detected.');
		}
		if (!existing) {
			this.#records.set(storageKey, Object.freeze({
				bytes: bytes.slice(),
				generation: ++this.#generation,
			}));
		}
		return reference;
	}

	async load(
		reference: VideoTimingAssetReference,
		options: Readonly<{ sourceSha256?: string }> = {},
	): Promise<VideoTimingAssetLoadResult> {
		let normalized: Readonly<VideoTimingAssetReference>;
		try { normalized = normalizeVideoTimingAssetReference(reference); } catch {
			return Object.freeze({ status: 'corrupt', index: null });
		}
		if (options.sourceSha256 !== undefined && options.sourceSha256 !== normalized.sourceSha256) {
			return Object.freeze({ status: 'source-mismatch', index: null });
		}
		const record = this.#records.get(normalized.storageKey);
		if (!record) return Object.freeze({ status: 'missing', index: null });
		try {
			if (bytesToHex(sha256(record.bytes)) !== normalized.sha256) throw new Error('digest');
			const index = decodeVideoTimingAsset(record.bytes);
			if (index.frameCount !== normalized.frameCount || index.timescale !== normalized.timescale
				|| index.finalFrameDurationTicks.toString() !== normalized.finalFrameDurationTicks
				|| record.bytes.byteLength !== normalized.byteLength) throw new Error('metadata');
			return Object.freeze({ status: 'available', index });
		} catch {
			return Object.freeze({ status: 'corrupt', index: null });
		}
	}

	async exportAsset(reference: VideoTimingAssetReference): Promise<Uint8Array> {
		const loaded = await this.load(reference);
		if (loaded.status !== 'available') throw new Error(`The timing asset is ${loaded.status}.`);
		return this.#records.get(reference.storageKey)!.bytes.slice();
	}

	async importAsset(reference: VideoTimingAssetReference, input: Uint8Array): Promise<void> {
		const normalized = normalizeVideoTimingAssetReference(reference);
		if (!(input instanceof Uint8Array) || input.byteLength !== normalized.byteLength
			|| bytesToHex(sha256(input)) !== normalized.sha256) {
			throw new Error('The handed-off timing asset failed its digest binding.');
		}
		const index = decodeVideoTimingAsset(input);
		if (index.frameCount !== normalized.frameCount || index.timescale !== normalized.timescale
			|| index.finalFrameDurationTicks.toString() !== normalized.finalFrameDurationTicks) {
			throw new Error('The handed-off timing asset failed its summary binding.');
		}
		const existing = this.#records.get(normalized.storageKey);
		if (existing && !equalBytes(existing.bytes, input)) throw new Error('The immutable timing asset cannot be overwritten.');
		if (!existing) this.#records.set(normalized.storageKey, Object.freeze({
			bytes: input.slice(),
			generation: ++this.#generation,
		}));
	}

	async reclaim(storageKey: string, options: VideoTimingAssetReclaimOptions): Promise<boolean> {
		const key = timingStorageKey(storageKey);
		if (typeof options?.isReferenced !== 'function') throw new TypeError('A timing reference fence is required.');
		const candidate = this.#records.get(key);
		if (!candidate || await options.isReferenced(key)) return false;
		await options.beforeDeleteFence?.();
		const current = this.#records.get(key);
		if (!current || current.generation !== candidate.generation || await options.isReferenced(key)) return false;
		return this.#records.delete(key);
	}

	/** Test-only byte mutation exercises corrupt-asset degradation without weakening publication. */
	testingCorrupt(storageKey: string, offset: number): void {
		const key = timingStorageKey(storageKey);
		const record = this.#records.get(key);
		if (!record) throw new ReferenceError('The timing asset is missing.');
		const bytes = record.bytes.slice();
		bytes[offset] ^= 0xff;
		this.#records.set(key, Object.freeze({ bytes, generation: record.generation }));
	}
}

export function videoTimingAssetArchiveDescriptor(reference: VideoTimingAssetReference) {
	const normalized = normalizeVideoTimingAssetReference(reference);
	return Object.freeze({
		kind: 'video-timing' as const,
		entry: `timing/${normalized.sha256}.scti`,
		encoding: normalized.encoding,
		storageKey: normalized.storageKey,
		size: normalized.byteLength,
		sha256: normalized.sha256,
	});
}

function timingReference(
	sourceSha256: string,
	sha: string,
	byteLength: number,
	index: VideoTimingIndex,
): Readonly<VideoTimingAssetReference> {
	return Object.freeze({
		encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: `${STORAGE_PREFIX}${sha}`,
		sha256: sha,
		sourceSha256,
		byteLength,
		frameCount: index.frameCount,
		timescale: index.timescale,
		finalFrameDurationTicks: index.finalFrameDurationTicks.toString(),
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
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`A lowercase SHA-256 ${label} digest is required.`);
	return value;
}

function int64(value: unknown, name: string): bigint {
	if (typeof value !== 'bigint' || value < 0n || value > 0x7fff_ffff_ffff_ffffn) {
		throw new RangeError(`${name} must be a non-negative signed 64-bit integer.`);
	}
	return value;
}

function positiveInt64(value: unknown, name: string): bigint {
	const result = int64(value, name);
	if (result === 0n) throw new RangeError(`${name} must be positive.`);
	return result;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}
