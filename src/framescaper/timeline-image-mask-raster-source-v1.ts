/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';

export interface FramescaperMaskRasterSourceTimelineImageV1 extends MaskRasterSourcePortV1 { close(): Promise<void> }
type Load = (key: string, options: Readonly<{ signal?: AbortSignal }>) => PromiseLike<BlobLike | null>;
const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, READ = Blob.prototype.arrayBuffer;

/** One selected immutable native body is serially borrowed and physically retired.
 * This owner borrows the media store; closing never closes its native connection. */
export function createFramescaperMaskRasterSourceTimelineImageV1(store: unknown): Readonly<FramescaperMaskRasterSourceTimelineImageV1> {
	const load = captureLoad(store); let sealed = false, busy = false, drain: Promise<void> | undefined, closing: Promise<void> | undefined;
	return Object.freeze({
		withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			if (sealed) return Promise.reject(new Error('The Frame brush source is closed.'));
			if (busy) return Promise.reject(new Error('The Frame brush source cannot overlap active bodies.'));
			busy = true; let complete!: () => void; drain = new Promise<void>(resolve => { complete = resolve; });
			const work = read(reference, consume, options); void work.then(settle, settle); return work;
			function settle() { busy = false; drain = undefined; complete(); }
		},
		close() { sealed = true; return closing ??= drain ?? Promise.resolve(); },
	});
	async function read<Result>(value: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, optionsValue: unknown): Promise<Result> {
		const options = record(optionsValue ?? {}, 'Frame brush options', ['signal'], []), signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'Frame brush options') : undefined;
		if (signal !== undefined) { Reflect.apply(CHECK, signal, []); if (Object.getPrototypeOf(signal) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal as object, key))) throw new TypeError('Frame brushes require an unmodified native signal.'); }
		const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }; check();
		if (typeof consume !== 'function') throw new TypeError('A scoped Frame brush consumer is required.');
		const raw = record(value, 'Frame brush reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
		const reference = normalizeBrushMaskResourceReferenceV1(field(raw, 'storageKey', 'Frame brush reference'));
		for (const key of ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const) if (field(raw, key, 'Frame brush reference') !== reference[key]) throw new TypeError('Frame brush reference differs from canonical identity.');
		if (sealed) throw new Error('The Frame brush source closed during admission.');
		const blob = await Reflect.apply(load, store, [reference.storageKey, signal === undefined ? {} : { signal }]) as BlobLike | null; check();
		if (blob === null || Number(Reflect.apply(BLOB_SIZE, blob, [])) !== reference.byteLength) throw new RangeError('The exact native Frame brush body is missing or stale.');
		const backing = await Reflect.apply(READ, blob, []) as ArrayBuffer, bytes = new Uint8Array(backing);
		let outcome: { value: Result } | { error: unknown };
		try { check(); outcome = { value: await withBrushMaskResourceV1({ reference, bytes, signal }, () => consume(bytes)) }; } catch (error) { outcome = { error }; }
		let cleanup: { error: unknown } | undefined;
		try { if (Number(Reflect.apply(SIZE, backing, [])) !== reference.byteLength) throw new TypeError('Frame brush backing was detached before native wipe.'); Reflect.apply(FILL, new Uint8Array(backing), [0]); } catch (error) { cleanup = { error }; }
		if ('error' in outcome) { if (cleanup && !Object.is(outcome.error, cleanup.error)) throw new AggregateError([outcome.error, cleanup.error], 'Frame brush operation and native retirement failed.', { cause: outcome.error }); throw outcome.error; }
		if (cleanup) throw cleanup.error; return outcome.value;
	}
}
function captureLoad(store: unknown): Load {
	if (!store || typeof store !== 'object') throw new TypeError('A Frame brush media store is required.'); let owner: object | null = store;
	for (let depth = 0; owner && depth < 32; depth++) { const descriptor = Object.getOwnPropertyDescriptor(owner, 'loadMediaAsset');
		if (descriptor) { if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Frame brush loading requires a data method.'); return descriptor.value as Load; } owner = Object.getPrototypeOf(owner) as object | null; }
	throw new TypeError('A captured Frame brush native body reader is required.');
}
