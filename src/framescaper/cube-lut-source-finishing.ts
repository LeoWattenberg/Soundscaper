/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { normalizeCubeLutProfileParamsV1 } from '../common/editor/video-cube-lut-profile-v1.ts';
import { withCubeLutResourceV1 } from '../common/editor/imaging/cube-lut-resource-v1.ts';
import type { CubeLutSourcePortV1 } from '../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../common/editor/video-color-cube-lut-v27.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';

export interface FramescaperCubeLutSourceFinishing extends CubeLutSourcePortV1 {
	/** Seal and drain only. The operation caller retains its exact failure;
	 * the source borrows the store and owns no native connection or target. */
	close(): Promise<void>;
}
type Load = (key: string, options: Readonly<{ signal?: AbortSignal }>) => PromiseLike<BlobLike | null>;
const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeBytes = Uint8Array, FILL = NativeBytes.prototype.fill;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const READ_BLOB = Blob.prototype.arrayBuffer;

/** One current-stage immutable native Blob body, bounded by its owning V27
 * reference. Native size/read ignore mutable Blob shadows. Every read is
 * independently authenticated, with no parsed-table or whole-stack cache.
 * The <=16MiB raw body plus the parser owner's detached scratch are scoped;
 * this is not a whole-heap or whole-project latency claim. */
export function createFramescaperCubeLutSourceFinishing(store: unknown): Readonly<FramescaperCubeLutSourceFinishing> {
	const load = captureLoad(store);
	let sealed = false, busy = false, drain: Promise<void> | undefined, closing: Promise<void> | undefined;
	return Object.freeze({
		withBytes<Result>(reference: Readonly<VideoCubeLutReferenceV1>,
			consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			if (sealed) return Promise.reject(new Error('The Frame LUT source is closed.'));
			if (busy) return Promise.reject(new Error('The Frame LUT source cannot overlap active bodies.'));
			busy = true;
			let complete!: () => void;
			drain = new Promise<void>(resolve => { complete = resolve; });
			const work = read(reference, consume, options);
			// Observe immediately while retaining the caller's original rejection.
			void work.then(settle, settle);
			return work;
			function settle() { busy = false; drain = undefined; complete(); }
		},
		close() { sealed = true; return closing ??= drain ?? Promise.resolve(); },
	});

	async function read<Result>(referenceValue: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>,
		optionsValue: unknown): Promise<Result> {
		const options = record(optionsValue ?? {}, 'Frame LUT source options', ['signal'], []);
		const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'Frame LUT source options') : undefined;
		const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
		check();
		if (typeof consume !== 'function') throw new TypeError('A scoped Frame LUT body consumer is required.');
		const reference = normalizeCubeLutProfileParamsV1({ lut: referenceValue }).lut;
		if (reference === null) throw new TypeError('A Frame LUT source requires a nonnull reference.');
		check();
		if (sealed) throw new Error('The Frame LUT source was closed during admission.');
		const blob = await Reflect.apply(load, store, [reference.storageKey, signal === undefined ? {} : { signal }]) as BlobLike | null;
		check();
		if (blob === null || Number(Reflect.apply(BLOB_SIZE, blob, [])) !== reference.byteLength) {
			throw new RangeError('The exact native Frame LUT body is missing or has a stale size.');
		}
		const backing = await Reflect.apply(READ_BLOB, blob, []) as ArrayBuffer;
		const raw = new NativeBytes(backing);
		try {
			check();
			if (raw.byteLength !== reference.byteLength) throw new RangeError('The native Frame LUT body length changed.');
			return await withCubeLutResourceV1({ reference, bytes: raw, signal }, async () => await consume(raw));
		} finally {
			if (Reflect.apply(BUFFER_SIZE, backing, []) !== 0) Reflect.apply(FILL, raw, [0]);
		}
	}
}

function captureLoad(store: unknown): Load {
	if (!store || typeof store !== 'object') throw new TypeError('A Frame LUT asset store is required.');
	let owner: object | null = store;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, 'loadMediaAsset');
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Frame LUT loading requires a data method.');
			return descriptor.value as Load;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('A captured Frame LUT asset reader is required.');
}
