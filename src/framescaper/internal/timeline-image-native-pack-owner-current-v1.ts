/* SPDX-License-Identifier: AGPL-3.0-only */

import { openFramescaperImageFramePackV1, estimateFramescaperImageFramePackReaderMetadataBytesV1 } from '../../common/editor/timeline-image-frame-pack-v1.ts';
import { decodeFramescaperImageFramePackHeaderV1, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES } from '../../common/editor/timeline-image-frame-pack-v1-layout.ts';
import type { FramescaperImageSourceV1 } from '../../common/editor/timeline-image-model.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from '../editor-selected-timeline-image-image-frame-source.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, JOIN = AbortSignal.any;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, READ = Blob.prototype.arrayBuffer;
const FILL = Uint8Array.prototype.fill, BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const TYPED_BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;

export function checkFramescaperNativeImageSignalCurrentV1(signal?: AbortSignal): void {
	if (signal !== undefined) Reflect.apply(CHECK, signal, []);
}
export function assertFramescaperNativeImageSignalCurrentV1(signal?: AbortSignal): void {
	if (signal === undefined) return; checkFramescaperNativeImageSignalCurrentV1(signal);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Current image reads require unmodified native cancellation behavior.');
	}
}
export function captureFramescaperNativeImageLoadCurrentV1(store: FramescaperStoredImageAssetStoreTimelineImage): FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset'] {
	return dataMethod<FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset']>(store, 'loadMediaAsset');
}
function dataMethod<Method extends (...args: never[]) => unknown>(receiver: object, key: string): Method {
	let owner: object | null = receiver;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Current image requires a data native body reader.');
			const method = descriptor.value as Method;
			return ((...args: Parameters<Method>) => Reflect.apply(method, receiver, args)) as Method;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('Current image requires a captured native body reader.');
}
export async function retireFramescaperNativeImageCurrentV1(primary: Readonly<{ error: unknown }> | undefined, tasks: readonly (() => void | Promise<void>)[]): Promise<void> {
	const failures: unknown[] = primary ? [primary.error] : [];
	for (const task of tasks) try { await task(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Frame reader operation and native retirement failed.', { cause: failures[0] });
}
function wipe(backing: ArrayBuffer): void {
	if (Number(Reflect.apply(BUFFER_SIZE, backing, []))) Reflect.apply(FILL, new Uint8Array(backing), [0]);
}
function retireCanonicalBacking(backing: ArrayBuffer, allocationLength: number): void {
	if (Number(Reflect.apply(BUFFER_SIZE, backing, [])) !== allocationLength) {
		throw new TypeError('Canonical image backing was detached or changed before physical retirement.');
	}
	wipe(backing);
}

/** Own the actual transferred native snapshot and unchanged pack reader. The
 * pending latch covers complete reads/consumers, independently of source recipe. */
export async function openFramescaperNativePackOwnerCurrentV1(store: FramescaperStoredImageAssetStoreTimelineImage, source: FramescaperImageSourceV1,
	signal: AbortSignal | undefined, admitMetadata: ((bytes: number) => void) | undefined, profile: 'source1' | 'editable', purpose: 'preview' | 'canonical-authoring' = 'preview') {
	if (profile !== 'source1' && profile !== 'editable') throw new TypeError('Unknown fixed native image pack profile.');
	if (purpose !== 'preview' && purpose !== 'canonical-authoring') throw new TypeError('Unknown fixed native image reader purpose.');
	if (purpose === 'canonical-authoring') {
		if (source.canonical.frameCount !== 1) throw new RangeError('Canonical authoring requires one static image frame.');
		if (canonicalWorkingBytes(source) > 512n * 1024n * 1024n) throw new RangeError('Canonical image frame exceeds its 512 MiB working byte bound.');
	}
	assertFramescaperNativeImageSignalCurrentV1(signal); const load = captureFramescaperNativeImageLoadCurrentV1(store);
	const check = () => { checkFramescaperNativeImageSignalCurrentV1(signal); };
	let snapshot: Uint8Array<ArrayBuffer> | undefined;
	try {
		check(); const body = await load(source.storageKey, signal === undefined ? {} : { signal }); check();
		if (body === null) throw new Error('Current image native body is missing.');
		const size = profile === 'source1' ? body.size : Number(Reflect.apply(SIZE, body, []));
		if (size !== source.assetByteLength) throw new Error('Current image native body has a stale size.');
		const readBody = profile === 'source1' ? dataMethod<() => Promise<ArrayBuffer>>(body, 'arrayBuffer') : () => Reflect.apply(READ, body, []) as Promise<ArrayBuffer>;
		if (profile === 'source1' && typeof body.slice !== 'function') throw new TypeError('Source1 image body requires a slice port.');
		const backing = await readBody();
		if (!(backing instanceof ArrayBuffer)) throw new TypeError('Current image native body requires a transferred ArrayBuffer.');
		snapshot = new Uint8Array(backing); check();
		if (snapshot.byteLength !== source.assetByteLength) throw new Error('Current image body length changed during its joined native read.');
		if (profile === 'source1') snapshot = new Uint8Array(structuredClone(backing, { transfer: [backing] }));
		const bytes = snapshot, encodedBacking = bytes.buffer, pending = new Set<Promise<unknown>>();
		let sealed = false, exclusive = false, closing: Promise<void> | undefined;
		const read = (offset: number, length: number) => { check(); return bytes.slice(offset, offset + length); };
		const estimate = profile === 'source1' ? estimateFramescaperImageFramePackReaderMetadataBytesV1(
			decodeFramescaperImageFramePackHeaderV1(bytes.subarray(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), source).receiptByteLength, source.canonical.frameCount) : undefined;
		if (estimate !== undefined) admitMetadata?.(estimate); check();
		// Range admission and the owner check cancellation. A captured pack signal
		// could reject after decode, before its allocation reaches retirement.
		const reader = await openFramescaperImageFramePackV1({ source, read });
		if (estimate !== undefined && estimate !== reader.residentMetadataByteEstimate) throw new Error('Current image pack changed its reader metadata estimate.');
		if (estimate === undefined) admitMetadata?.(reader.residentMetadataByteEstimate); check();
		const run = <Result>(consume: (admitted?: AbortSignal) => Promise<Result>, external?: AbortSignal, ownExclusive = false): Promise<Result> => {
			if (sealed) return Promise.reject(new Error('Current image frame source is closed.'));
			if (exclusive || ownExclusive && pending.size) return Promise.reject(new Error('Current image frame source cannot overlap recipe readers.'));
			let admitted: AbortSignal | undefined;
			try {
				assertFramescaperNativeImageSignalCurrentV1(signal); assertFramescaperNativeImageSignalCurrentV1(external);
				admitted = signal !== undefined && external !== undefined && external !== signal
					? Reflect.apply(JOIN, AbortSignal, [[signal, external]]) as AbortSignal : external ?? signal;
			} catch (error) { return Promise.reject(error); }
			let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
			const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); pending.add(work);
			if (ownExclusive) exclusive = true;
			const finish = () => { pending.delete(work); if (ownExclusive) exclusive = false; };
			void work.then(finish, finish);
			void Promise.resolve().then(() => { checkFramescaperNativeImageSignalCurrentV1(admitted); return consume(admitted); }).then(resolve, reject);
			return work;
		};
		return Object.freeze({ reader, read, run,
			withCanonicalFrame<Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, external?: AbortSignal): Promise<Result> {
				if (typeof consume !== 'function') return Promise.reject(new TypeError('Canonical image frame requires a callable consumer.'));
				if (source.canonical.frameCount !== 1) return Promise.reject(new RangeError('Canonical authoring requires one static image frame.'));
				if (canonicalWorkingBytes(source) > 512n * 1024n * 1024n) {
					return Promise.reject(new RangeError('Canonical image frame exceeds its 512 MiB working byte bound.'));
				}
				return run(async admitted => {
					// Always receive custody of the decoded allocation before checking
					// source/borrow cancellation or exposing it to the consumer.
					const pixels = await reader.readFrame(0), backing = Reflect.apply(TYPED_BUFFER, pixels, []) as ArrayBuffer;
					const allocationLength = Number(Reflect.apply(BUFFER_SIZE, backing, []));
					let outcome: { value: Result } | { error: unknown };
					try {
						checkFramescaperNativeImageSignalCurrentV1(admitted);
						const frame: Readonly<PixelFrameV1> = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1 as const, width: source.canonical.width,
							height: source.canonical.height, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }), pixels: pixels as Uint8Array<ArrayBuffer> });
						const value = await consume(frame); checkFramescaperNativeImageSignalCurrentV1(admitted); outcome = { value };
					} catch (error) {
						let primary = error; try { checkFramescaperNativeImageSignalCurrentV1(admitted); } catch (reason) { primary = reason; }
						outcome = { error: primary };
					}
					await retireFramescaperNativeImageCurrentV1('error' in outcome ? outcome : undefined, [() => retireCanonicalBacking(backing, allocationLength)]);
					if ('error' in outcome) throw outcome.error; return outcome.value;
				}, external, true);
			},
			closeAndJoin(tasks: readonly (() => void | Promise<void>)[] = []): Promise<void> {
				if (closing) return closing; sealed = true;
				let resolve!: () => void, reject!: (reason: unknown) => void;
				closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
				void (async () => { await Promise.allSettled([...pending]); await retireFramescaperNativeImageCurrentV1(undefined, [...tasks, () => wipe(encodedBacking)]); })().then(resolve, reject);
				return closing;
			},
		});
	} catch (error) { await retireFramescaperNativeImageCurrentV1({ error }, [() => { if (snapshot) wipe(snapshot.buffer); }]); throw error; }
}

export type FramescaperNativePackOwnerCurrentV1 = Awaited<ReturnType<typeof openFramescaperNativePackOwnerCurrentV1>>;
function canonicalWorkingBytes(source: FramescaperImageSourceV1): bigint {
	return BigInt(source.assetByteLength) * 3n + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n + 4_096n;
}
