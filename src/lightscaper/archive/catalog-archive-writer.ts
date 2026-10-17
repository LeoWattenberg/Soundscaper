/* SPDX-License-Identifier: AGPL-3.0-only */

import { ZipWriter } from '@zip.js/zip.js/index-native.js';
import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS, SCAPE_FORMAT, SCAPE_FORMAT_VERSION } from '../../common/editor/scape-archive-limits.ts';
import type { ScapeAssetDescriptor, ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { createScapeDigest, digestScapeBytes, scapeBytesStream, scapeHex } from '../../common/editor/scape-byte-stream.ts';
import { createScapeExportDestination } from '../../common/editor/scape-export-destination.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../common/editor/scape-blob-budget.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND, PHOTO_CATALOG_PACK_ENCODING } from '../../common/editor/scape-photo-catalog-pack.ts';
import { SCAPE_MIME_TYPE } from '../../common/editor/scape-project-format.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { encodePhotoCatalogPackV1, type PhotoCatalogPackInput } from './catalog-pack.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS, type PhotoCatalogArchiveIdentityGuard, type PhotoCatalogArchivePackV1 } from './catalog-archive-contract.ts';
import { PhotoCatalogPackSequence } from './catalog-pack-sequence.ts';
import { maximumPhotoCatalogStreamingOutputBytesV1, maximumPhotoCatalogStreamingOutputBytesV3 } from './catalog-archive-capacity.ts';

export interface PhotoCatalogArchiveExportOptions {
	readonly signal?: AbortSignal;
	readonly writable?: WritableStream<Uint8Array>;
	readonly maximumBlobBytes?: number;
}
export interface PhotoCatalogArchiveWrittenResult<Document> {
	readonly blob: Blob | null; readonly byteLength: number; readonly manifest: ScapeManifest; readonly document: Document;
}
export interface PhotoCatalogArchivePackWriter {
	addPack(descriptor: Pick<ScapeAssetDescriptor, 'sourceId' | 'entry' | 'kind' | 'encoding'>, bytes: AsyncIterable<Uint8Array>): Promise<void>;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** One ZIP/destination owner is reused by the closed v1 and explicit v2 exporters. */
export async function writePhotoCatalogArchive<Document>(root: PhotoCatalogRootV1,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>, identity: PhotoCatalogArchiveIdentityGuard,
	prepare: (packs: readonly PhotoCatalogArchivePackV1[], writer: PhotoCatalogArchivePackWriter) => Promise<Readonly<{
		document: Document; text: string; schemaVersion: 1 | 2 | 3 | 4; beforeFinish?: () => Promise<void> }>>,
	options: PhotoCatalogArchiveExportOptions = {}, maximumStreamingOutputBytes = maximumPhotoCatalogStreamingOutputBytesV1()): Promise<PhotoCatalogArchiveWrittenResult<Document>> {
	const signal = options.signal, blobMaximum = options.maximumBlobBytes ?? SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES;
	if (!Number.isSafeInteger(blobMaximum) || blobMaximum < 1 || blobMaximum > SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES) throw new RangeError('Photo archive Blob maximum must tighten the shared maximum.');
	if (!Number.isSafeInteger(maximumStreamingOutputBytes) || maximumStreamingOutputBytes < 1
		|| maximumStreamingOutputBytes > maximumPhotoCatalogStreamingOutputBytesV3()) throw new RangeError('Photo archive output bound exceeds its registered entry profile.');
	const checkAbort = () => { if (signal) Reflect.apply(nativeAbort, signal, []); };
	checkAbort();
	const parts: Uint8Array<ArrayBuffer>[] = [], target = options.writable ?? new WritableStream<Uint8Array>({
		write(bytes) { parts.push(new Uint8Array(bytes)); }, abort() { parts.length = 0; },
	});
	const destination = createScapeExportDestination(target, SCAPE_MIME_TYPE, options.writable ? maximumStreamingOutputBytes : blobMaximum);
	const writer = new ZipWriter(destination.target, { dataDescriptor: true, dataDescriptorSignature: true,
		extendedTimestamp: true, zip64: true, level: 0, useWebWorkers: false, signal });
	let sequence: PhotoCatalogPackSequence | undefined, expandedBytes = 0;
	const packs: PhotoCatalogArchivePackV1[] = [], assets: ScapeAssetDescriptor[] = [];
	const packWriter: PhotoCatalogArchivePackWriter = { async addPack(descriptor, bytes) {
		if (assets.length >= LIMITS.maximumPacks) throw new RangeError('Photo catalog requires too many Scape asset packs.');
		const digest = createScapeDigest(); let size = 0;
		async function* hashed() { for await (const chunk of bytes) { consumeExpanded(chunk.byteLength); size += chunk.byteLength; digest.update(chunk); yield chunk; } }
		await writer.add(descriptor.entry, iterableStream(hashed()), { level: 0, zip64: true, signal });
		assets.push({ ...descriptor, size, sha256: scapeHex(digest.digest()) });
	} };
	try {
		sequence = new PhotoCatalogPackSequence(photos, identity, signal);
		let records = await sequence.nextPack();
		while (records) {
			const ordinal = String(packs.length + 1).padStart(6, '0'), entry = `assets/photo-pack-${ordinal}.bin`, packId = `photo-pack-${ordinal}`;
			let photoCount = 0;
			async function* counted() { for await (const record of records!) { photoCount += 1; yield record; } }
			await packWriter.addPack({ sourceId: packId, entry, kind: PHOTO_CATALOG_PACK_ASSET_KIND, encoding: PHOTO_CATALOG_PACK_ENCODING }, encodePhotoCatalogPackV1(counted(), { signal }));
			packs.push(Object.freeze({ id: packId, entry, photoCount })); records = await sequence.nextPack();
		}
		if (identity.count !== root.photoCount) throw new RangeError('Photo archive enumeration differs from its catalog count.');
		await sequence.close();
		const prepared = await prepare(Object.freeze(packs), packWriter), projectBytes = new TextEncoder().encode(prepared.text);
		consumeExpanded(projectBytes.byteLength);
		await writer.add('project.json', scapeBytesStream(projectBytes), { level: 0, zip64: true, signal });
		const manifest: ScapeManifest = { format: SCAPE_FORMAT, formatVersion: SCAPE_FORMAT_VERSION,
			project: { entry: 'project.json', schemaFamily: 'lightscaper', schemaVersion: prepared.schemaVersion, size: projectBytes.byteLength, sha256: digestScapeBytes(projectBytes) }, assets };
		const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)); consumeExpanded(manifestBytes.byteLength);
		await writer.add('manifest.json', scapeBytesStream(manifestBytes), { level: 0, zip64: true, signal });
		await prepared.beforeFinish?.();
		await destination.finish(writer, signal, checkAbort);
		return Object.freeze({ blob: options.writable ? null : new Blob(parts, { type: SCAPE_MIME_TYPE }), byteLength: destination.byteLength, manifest, document: prepared.document });
	} catch (error) {
		const cleanup: unknown[] = []; try { await sequence?.close(); } catch (failure) { cleanup.push(failure); }
		const observedAbort = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
			&& Object.is(error, Reflect.apply(nativeReason, signal, []));
		const classification = observedAbort ? { primaryIsAbort: true } : undefined;
		try {
			return await destination.abort(writer, aggregateScapeErrors(error, cleanup, 'Photo archive export and enumeration cleanup failed.', classification), classification);
		} catch (failure) {
			// ZIP retirement may repeat the same cancellation. Retain distinct cleanup failures without inspecting any reason.
			if (observedAbort && (Object.is(failure, error) || failure instanceof AggregateError
				&& (failure.errors as unknown[]).every(value => Object.is(value, error)))) throw error;
			throw failure;
		}
	}
	function consumeExpanded(bytes: number): void {
		if (bytes > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - expandedBytes) throw new RangeError('Photo archive exceeds its shared expanded byte maximum.');
		expandedBytes += bytes;
	}
}
function iterableStream(chunks: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
	const iterator = chunks[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({ async pull(controller) {
		const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value);
	}, async cancel() { await iterator.return?.(); } });
}
