/* SPDX-License-Identifier: AGPL-3.0-only */

import { externalMediaForSource, normalizeExternalMedia,
	type ExternalMedia } from './desktop-external-media.ts';
import { verifyScapeAssetBytes } from './scape-archive-media.ts';
import { digestMediaContent } from './storage/media-content-digest.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from './scape-archive-envelope.ts';
import type { ScapeImportTransaction } from './scape-import-transaction.ts';
import type { OwnedMediaAssetPublication } from './storage/media-asset-write-contract.ts';
import type { StorageRecord } from './storage/media-records.ts';
import { createScapeDigest, scapeHex } from './scape-archive-media.ts';
import { packPlanarFloat32 } from './wavpack/index.js';
import { openExternalMediaPcm } from './external-media-pcm-reader.ts';
import { aggregateScapeErrors } from './scape-abort.ts';

export type ExternalAudioDecoder = (file: Blob, source: Readonly<Record<string, unknown>>,
	signal?: AbortSignal) => Promise<readonly Float32Array[]>;
export type ExternalMediaResolver = (reference: ExternalMedia, sourceId: string,
	signal?: AbortSignal) => Promise<Blob | { readonly file: Blob; release(): Promise<void> }>;

interface ExternalMediaImportStore {
	beginSourceWrite(sourceId: string, metadata: Readonly<Record<string, unknown>>): Promise<{
		write(channels: readonly Float32Array[], options?: { signal?: AbortSignal }): Promise<unknown>;
		commit(metadata: Readonly<Record<string, unknown>>, options: { signal?: AbortSignal; ifAbsent: boolean }): Promise<StorageRecord>;
		abort(): Promise<unknown>;
	}>;
	beginMediaAssetWrite(sourceId: string, metadata: Readonly<Record<string, unknown>>, options: {
		expectedBytes: number; expectedSha256: string; signal?: AbortSignal;
	}): Promise<{
		maximumChunkBytes: number;
		write(bytes: Uint8Array, options?: { signal?: AbortSignal }): Promise<unknown>;
		commitOwned(options?: { signal?: AbortSignal }): Promise<OwnedMediaAssetPublication>;
		abort(): Promise<unknown>;
	}>;
}

/** Resolve originals only through the selected desktop archive's native grant. */
export async function importExternalScapeAsset(request: Readonly<{
	source: Record<string, unknown>; originalSourceId: string; asset: ScapeAssetDescriptor;
	entry: ScapeArchiveEntry; store: ExternalMediaImportStore; transaction: ScapeImportTransaction;
	resolveExternalMedia?: ExternalMediaResolver; decodeExternalAudio?: ExternalAudioDecoder;
	signal?: AbortSignal;
}>): Promise<void> {
	const { source, asset, entry, signal } = request;
	if (!request.resolveExternalMedia) throw new Error('This project references external files. Open it in the desktop app or consolidate its media first.');
	if (entry.uncompressedSize > 64 * 1024 || !entry.getData) throw new RangeError('The external media descriptor is too large or unavailable.');
	const chunks: Uint8Array[] = [];
	let received = 0;
	await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
		signal?.throwIfAborted();
		received += chunk.byteLength;
		if (received > entry.uncompressedSize) throw new Error('The external media descriptor exceeded its size.');
		chunks.push(chunk.slice());
	} }), { signal, strictness: 'strict' });
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	verifyScapeAssetBytes(bytes, asset, 'external media descriptor');
	const reference = normalizeExternalMedia(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
	const sourceReference = externalMediaForSource(source);
	if (!sourceReference || JSON.stringify(reference) !== JSON.stringify(sourceReference)) {
		throw new Error('The external media descriptor does not match its project source.');
	}
	const resolved = await request.resolveExternalMedia(reference, request.originalSourceId, signal);
	try {
		await persistExternalMedia(request, reference, resolved instanceof Blob ? resolved : resolved.file);
	} catch (error) {
		if (!(resolved instanceof Blob)) {
			try { await resolved.release(); }
			catch (releaseError) { throw aggregateScapeErrors(error, [releaseError], 'External media import and capability release both failed.'); }
		}
		throw error;
	}
	if (!(resolved instanceof Blob)) await resolved.release();
}

async function persistExternalMedia(
	request: Parameters<typeof importExternalScapeAsset>[0],
	reference: ExternalMedia,
	file: Blob,
): Promise<void> {
	const { source, store, transaction, signal } = request;
	signal?.throwIfAborted();
	if (file.size !== reference.byteLength || await digestMediaContent(file, { signal }) !== reference.sha256) {
		throw new Error(`External file ${String(source.name)} is missing or has changed since import.`);
	}
	if (source.kind === 'video') {
		const writer = await store.beginMediaAssetWrite(String(source.id), { name: source.name, mimeType: source.mimeType },
			{ expectedBytes: file.size, expectedSha256: reference.sha256, signal });
		let publication: OwnedMediaAssetPublication | null = null, tracked = false;
		try {
			for (let position = 0; position < file.size; position += writer.maximumChunkBytes) {
				signal?.throwIfAborted();
				await writer.write(new Uint8Array(await file.slice(position, position + writer.maximumChunkBytes).arrayBuffer()), { signal });
			}
			publication = await writer.commitOwned({ signal });
			transaction.trackProvisionalMedia(publication); tracked = true;
			signal?.throwIfAborted();
			if (publication.metadata.sha256 !== reference.sha256 || publication.metadata.size !== reference.byteLength) {
				throw new Error('The persisted external video does not match its verified original.');
			}
		} catch (error) {
			try { if (!publication) await writer.abort(); else if (!tracked) await publication.discardIfCurrent(); }
			catch (cleanupError) { throw aggregateScapeErrors(error, [cleanupError], 'External video import and cleanup both failed.'); }
			throw error;
		}
		return;
	}
	const pcm = await openExternalMediaPcm(file, source, signal);
	const channels = pcm ? null : await request.decodeExternalAudio?.(file, source, signal);
	if (!pcm && !channels) throw new Error('The desktop external-audio decoder is unavailable.');
	if (channels && (channels.length !== source.channelCount || channels.some((channel) => channel.length !== source.frameCount))) {
		throw new Error(`External audio ${String(source.name)} does not match its recorded sample shape.`);
	}
	const writer = await store.beginSourceWrite(String(source.id), source);
	const digest = createScapeDigest();
	try {
		const write = async (chunk: readonly Float32Array[]): Promise<void> => {
			signal?.throwIfAborted();
			const header = new Uint8Array(4);
			new DataView(header.buffer).setUint32(0, chunk[0]!.length, true);
			digest.update(header); digest.update(new Uint8Array(packPlanarFloat32(chunk)));
			await writer.write(chunk, { signal });
		};
		if (pcm) await pcm.stream(write);
		else for (let position = 0; position < Number(source.frameCount); position += Number(source.chunkFrames)) {
			await write(channels!.map((channel) => channel.subarray(position, position + Number(source.chunkFrames))));
		}
		if (reference.contentSha256 !== null && scapeHex(digest.digest()) !== reference.contentSha256) {
			throw new Error(`External audio ${String(source.name)} decoded to different samples.`);
		}
		transaction.trackProvisionalSource(await writer.commit(source, { signal, ifAbsent: true }));
	} catch (error) { await writer.abort(); throw error; }
}
