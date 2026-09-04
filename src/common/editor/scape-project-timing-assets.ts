/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTimingAssetReference,
	type VideoTimingAssetReference,
} from './video-timing-asset-reference.ts';

/**
 * Video timing assets inside a Scape archive.
 *
 * A timing asset is content-addressed, so several video sources in one project routinely
 * name the same one and the archive carries a single copy. That makes agreement the thing
 * to check on the way in and out: two sources that name the same storage key must describe
 * it identically, or the archive would claim one body under two contradictory descriptions.
 */

/** A writer that can commit bytes it owns, as a Scape media import requires. */
export interface OwnedScapeMediaWriter {
	readonly maximumChunkBytes: number;
	readonly bytesWritten: number;
	write(bytes: Uint8Array, options?: unknown): Promise<unknown>;
	commit(options?: unknown): unknown;
	commitOwned(options?: unknown): unknown;
	abort(): unknown;
}

/** Collect one reference per timing asset the sources name, refusing disagreement. */
export function indexScapeTimingReferences(
	sources: readonly { kind?: string, timingAsset?: unknown }[],
): ReadonlyMap<string, Readonly<VideoTimingAssetReference>> {
	const references = new Map<string, Readonly<VideoTimingAssetReference>>();
	for (const source of sources) {
		if (source?.kind !== 'video' || source.timingAsset == null) continue;
		const reference = normalizeVideoTimingAssetReference(source.timingAsset);
		const existing = references.get(reference.storageKey);
		if (existing && !sameScapeTimingBodyReference(existing, reference)) {
			throw new Error(`Video sources sharing timing asset ${reference.storageKey} have conflicting references.`);
		}
		if (!existing) references.set(reference.storageKey, reference);
	}
	return references;
}

/** Whether two references describe the same timing body, field for field. */
export function sameScapeTimingBodyReference(
	left: Readonly<VideoTimingAssetReference>, right: Readonly<VideoTimingAssetReference>,
): boolean {
	return left.encoding === right.encoding
		&& left.storageKey === right.storageKey
		&& left.sha256 === right.sha256
		&& left.byteLength === right.byteLength
		&& left.frameCount === right.frameCount
		&& left.timescale === right.timescale
		&& left.finalFrameDurationTicks === right.finalFrameDurationTicks;
}

/** Wrap a writer so everything written through it is also kept for verification. */
export function captureScapeTimingWriter(
	writer: OwnedScapeMediaWriter, chunks: Uint8Array[],
): OwnedScapeMediaWriter {
	return {
		maximumChunkBytes: writer.maximumChunkBytes,
		get bytesWritten() { return writer.bytesWritten; },
		async write(bytes: Uint8Array, options?: unknown) {
			chunks.push(bytes.slice());
			await writer.write(bytes, options);
		},
		commit: (options?: unknown) => writer.commit(options),
		commitOwned: (options?: unknown) => writer.commitOwned(options),
		abort: () => writer.abort(),
	};
}

/** A Scape media import must own what it writes, so it can roll the whole import back. */
export function assertOwnedScapeMediaWriter(writer: unknown): asserts writer is OwnedScapeMediaWriter {
	if (!writer || typeof writer !== 'object' || typeof (writer as OwnedScapeMediaWriter).commitOwned !== 'function') {
		throw new TypeError('A Scape media import requires an ownership-aware transactional writer.');
	}
}

/** Join captured chunks into exactly the admitted byte length, or refuse. */
export function joinScapeTimingChunks(
	chunks: readonly Uint8Array[], expectedBytes: number,
): Uint8Array {
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength > output.byteLength - offset) {
			throw new Error('The Scape timing asset exceeded its admitted byte length.');
		}
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	if (offset !== output.byteLength) throw new Error('The Scape timing asset ended before its admitted byte length.');
	return output;
}
