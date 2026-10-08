/* SPDX-License-Identifier: AGPL-3.0-only */

import { ZipWriter } from '@zip.js/zip.js/index-native.js';
import { aggregateScapeErrors, throwIfScapeAborted } from '../../common/editor/scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS, SCAPE_FORMAT, SCAPE_FORMAT_VERSION } from '../../common/editor/scape-archive-limits.ts';
import type { ScapeAssetDescriptor, ScapeManifest } from '../../common/editor/scape-archive-envelope.ts';
import { createScapeDigest, digestScapeBytes, scapeBytesStream, scapeHex } from '../../common/editor/scape-byte-stream.ts';
import { createScapeExportDestination } from '../../common/editor/scape-export-destination.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../common/editor/scape-blob-budget.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND, PHOTO_CATALOG_PACK_ENCODING } from '../../common/editor/scape-photo-catalog-pack.ts';
import { SCAPE_MIME_TYPE } from '../../common/editor/scape-project-format.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { encodePhotoCatalogPackV1, type PhotoCatalogPackInput } from './catalog-pack.ts';
import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 as LIMITS, PhotoCatalogArchiveIdentityGuard, normalizePhotoCatalogArchiveV1, serializePhotoCatalogArchiveV1, type PhotoCatalogArchiveDocumentV1, type PhotoCatalogArchivePackV1 } from './catalog-archive-contract.ts';
import { PhotoCatalogPackSequence } from './catalog-pack-sequence.ts';
import { maximumPhotoCatalogStreamingOutputBytesV1 } from './catalog-archive-capacity.ts';

export { maximumPhotoCatalogStreamingOutputBytesV1 } from './catalog-archive-capacity.ts';

export interface PhotoCatalogArchiveExportOptions {
	readonly signal?: AbortSignal;
	readonly writable?: WritableStream<Uint8Array>;
	readonly maximumBlobBytes?: number;
}

export interface PhotoCatalogArchiveExportResult {
	readonly blob: Blob | null;
	readonly byteLength: number;
	readonly manifest: ScapeManifest;
	readonly document: PhotoCatalogArchiveDocumentV1;
}

export async function exportPhotoCatalogArchiveV1(
	rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	options: PhotoCatalogArchiveExportOptions = {},
): Promise<PhotoCatalogArchiveExportResult> {
	const root = validateLightscaperDocumentV1(rootValue);
	if (root.kind !== 'photo-catalog') throw new TypeError('Photo archive export requires a catalog root.');
	const signal = options.signal;
	const blobMaximum = options.maximumBlobBytes ?? SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES;
	if (!Number.isSafeInteger(blobMaximum) || blobMaximum < 1 || blobMaximum > SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES) throw new RangeError('Photo archive Blob maximum must tighten the shared maximum.');
	throwIfScapeAborted(signal);
	const parts: Uint8Array<ArrayBuffer>[] = [];
	const target = options.writable ?? new WritableStream<Uint8Array>({
		write(bytes) { parts.push(new Uint8Array(bytes)); },
		abort() { parts.length = 0; },
	});
	const outputMaximum = options.writable ? maximumPhotoCatalogStreamingOutputBytesV1() : blobMaximum;
	const destination = createScapeExportDestination(target, SCAPE_MIME_TYPE, outputMaximum);
	const writer = new ZipWriter(destination.target, { dataDescriptor: true, dataDescriptorSignature: true,
		extendedTimestamp: true, zip64: true, level: 0, useWebWorkers: false, signal });
	const identity = new PhotoCatalogArchiveIdentityGuard(root);
	let sequence: PhotoCatalogPackSequence | undefined;
	const packs: PhotoCatalogArchivePackV1[] = [];
	const assets: ScapeAssetDescriptor[] = [];
	let expandedBytes = 0;
	try {
		sequence = new PhotoCatalogPackSequence(photos, identity, signal);
		let records = await sequence.nextPack();
		while (records) {
			if (packs.length >= LIMITS.maximumPacks) throw new RangeError('Photo catalog requires too many Scape packs.');
			const ordinal = String(packs.length + 1).padStart(6, '0');
			const entry = `assets/photo-pack-${ordinal}.bin`;
			const packId = `photo-pack-${ordinal}`;
			const digest = createScapeDigest();
			let size = 0;
			let photoCount = 0;
			async function* counted() {
				for await (const record of records!) { photoCount += 1; yield record; }
			}
			async function* hashed() {
				for await (const bytes of encodePhotoCatalogPackV1(counted(), { signal })) {
					consumeExpanded(bytes.byteLength); size += bytes.byteLength; digest.update(bytes); yield bytes;
				}
			}
			await writer.add(entry, iterableStream(hashed()), { level: 0, zip64: true, signal });
			packs.push(Object.freeze({ id: packId, entry, photoCount }));
			assets.push({ sourceId: packId, entry, kind: PHOTO_CATALOG_PACK_ASSET_KIND,
				encoding: PHOTO_CATALOG_PACK_ENCODING, size, sha256: scapeHex(digest.digest()) });
			records = await sequence.nextPack();
		}
		if (identity.count !== root.photoCount) throw new RangeError('Photo archive enumeration differs from its catalog count.');
		await sequence.close();
		const document = normalizePhotoCatalogArchiveV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
			kind: 'photo-catalog-archive', id: root.id, title: root.name, catalog: root, packs });
		const projectBytes = new TextEncoder().encode(serializePhotoCatalogArchiveV1(document));
		consumeExpanded(projectBytes.byteLength);
		await writer.add('project.json', scapeBytesStream(projectBytes), { level: 0, zip64: true, signal });
		const manifest: ScapeManifest = { format: SCAPE_FORMAT, formatVersion: SCAPE_FORMAT_VERSION,
			project: { entry: 'project.json', schemaFamily: 'lightscaper', schemaVersion: 1,
				size: projectBytes.byteLength, sha256: digestScapeBytes(projectBytes) }, assets };
		const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
		consumeExpanded(manifestBytes.byteLength);
		await writer.add('manifest.json', scapeBytesStream(manifestBytes), { level: 0, zip64: true, signal });
		await destination.finish(writer, signal);
		return Object.freeze({ blob: options.writable ? null : new Blob(parts, { type: SCAPE_MIME_TYPE }),
			byteLength: destination.byteLength, manifest, document });
	} catch (error) {
		const cleanup: unknown[] = [];
		try { await sequence?.close(); } catch (failure) { cleanup.push(failure); }
		return destination.abort(writer, aggregateScapeErrors(error, cleanup, 'Photo archive export and enumeration cleanup failed.'));
	}

	function consumeExpanded(bytes: number): void {
		if (bytes > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - expandedBytes) throw new RangeError('Photo archive exceeds its shared expanded byte maximum.');
		expandedBytes += bytes;
	}
}

function iterableStream(chunks: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
	const iterator = chunks[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await iterator.next();
			if (next.done) controller.close(); else controller.enqueue(next.value);
		},
		async cancel() { await iterator.return?.(); },
	});
}
