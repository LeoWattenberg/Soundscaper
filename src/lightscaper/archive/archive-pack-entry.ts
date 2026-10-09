/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import { createScapeDigest, scapeHex, verifyScapeExtractedAsset } from '../../common/editor/scape-archive-media.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAbort = AbortSignal.prototype.throwIfAborted;

/** One authenticated backpressure bridge, shared by photo-pack1 and stack-pack1. */
export async function readCatalogArchivePackEntry(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, maximumChunkBytes: number,
	decode: (source: AsyncIterable<Uint8Array>) => Promise<number>, signal?: AbortSignal, label = 'Photo pack'): Promise<number> {
	if (typeof entry.getData !== 'function') throw new Error(`${label} archive entry cannot be read.`);
	const digest = createScapeDigest(); let size = 0;
	let control: TransformStreamDefaultController<Uint8Array> | undefined;
	const bridge = new TransformStream<Uint8Array, Uint8Array>({
		start(controller) { control = controller; },
		transform(chunk, controller) {
			if (signal) Reflect.apply(nativeAbort, signal, []); const view = photoPackByteView(chunk);
			if (view.byteLength < 1 || view.byteLength > maximumChunkBytes) throw new RangeError(`${label} archive emission exceeds its chunk bound.`);
			if (view.byteLength > descriptor.size - size) throw new RangeError(`${label} emits more bytes than its descriptor.`);
			budget.consume(view.byteLength, entry.filename); const bytes = new Uint8Array(view);
			digest.update(bytes); size += bytes.byteLength; controller.enqueue(bytes);
		},
	});
	const produce = Promise.resolve().then(() => entry.getData!(bridge.writable, { signal, strictness: 'strict' }));
	const settled = produce.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => {
		control?.error(error); return { failed: true, error };
	});
	let count = 0, failure: unknown, failed = false;
	try { count = await decode(readChunks(bridge.readable)); } catch (error) { failed = true; failure = error; control?.error(error); }
	const production = await settled;
	if (failed) {
		const primaryIsAbort = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
			&& Reflect.apply(nativeReason, signal, []) === failure;
		throw aggregateScapeErrors(failure, production.failed && production.error !== failure ? [production.error] : [],
			`${label} decoding and extraction failed.`, primaryIsAbort ? { primaryIsAbort: true } : undefined);
	}
	if (production.failed) throw production.error;
	verifyScapeExtractedAsset(descriptor, scapeHex(digest.digest()), size, entry.filename); return count;
}
async function* readChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
	const reader = stream.getReader(); let finished = false;
	try { while (true) { const next = await reader.read(); if (next.done) { finished = true; return; } yield next.value; } }
	finally { try { if (!finished) await reader.cancel(); } finally { reader.releaseLock(); } }
}
