/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, throwIfScapeAborted } from '../../common/editor/scape-abort.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import { createScapeDigest, scapeHex, verifyScapeExtractedAsset } from '../../common/editor/scape-archive-media.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V1, readPhotoCatalogPackV1 } from './catalog-pack.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

/** Backpressure retains at most one bounded emitted chunk while staging a pack. */
export async function readPhotoCatalogPackEntryV1(
	entry: ScapeArchiveEntry,
	descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget,
	consume: (photo: PhotoDocumentV1, original: AsyncIterable<Uint8Array>) => Promise<void>,
	signal?: AbortSignal,
): Promise<number> {
	if (typeof entry.getData !== 'function') throw new Error('Photo pack archive entry cannot be read.');
	const digest = createScapeDigest();
	let size = 0;
	let control: TransformStreamDefaultController<Uint8Array> | undefined;
	const bridge = new TransformStream<Uint8Array, Uint8Array>({
		start(controller) { control = controller; },
		transform(chunk, controller) {
			throwIfScapeAborted(signal);
			const view = photoPackByteView(chunk);
			if (view.byteLength < 1 || view.byteLength > PHOTO_CATALOG_PACK_LIMITS_V1.maximumChunkBytes) throw new RangeError('Photo pack archive emission exceeds its chunk bound.');
			if (view.byteLength > descriptor.size - size) throw new RangeError('Photo pack emits more bytes than its descriptor.');
			budget.consume(view.byteLength, entry.filename);
			const bytes = new Uint8Array(view);
			digest.update(bytes); size += bytes.byteLength;
			controller.enqueue(bytes);
		},
	});
	const produce = Promise.resolve().then(() => entry.getData!(bridge.writable, { signal, strictness: 'strict' }));
	// Observe production failures immediately and unblock a pending decoder read.
	const settled = produce.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => {
		control?.error(error); return { failed: true, error };
	});
	let count = 0;
	let failure: unknown;
	let failed = false;
	try { count = await readPhotoCatalogPackV1(readChunks(bridge.readable), consume, { signal }); }
	catch (error) { failed = true; failure = error; control?.error(error); }
	const production = await settled;
	if (failed) throw aggregateScapeErrors(failure, production.failed && production.error !== failure ? [production.error] : [], 'Photo pack decoding and extraction failed.');
	if (production.failed) throw production.error;
	verifyScapeExtractedAsset(descriptor, scapeHex(digest.digest()), size, entry.filename);
	return count;
}

async function* readChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
	const reader = stream.getReader();
	let finished = false;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) { finished = true; return; }
			yield next.value;
		}
	} finally {
		if (!finished) await reader.cancel();
		reader.releaseLock();
	}
}
