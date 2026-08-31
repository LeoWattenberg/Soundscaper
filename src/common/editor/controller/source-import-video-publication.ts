/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../storage/media-asset-write-contract.ts';

interface ImportedVideoPublicationStore {
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			expectedBytes: number;
			expectedSha256: string;
			signal?: AbortSignal;
		}>,
	): PromiseLike<OwnedMediaAssetWriter>;
}

interface ImportByteSource {
	readonly type?: unknown;
	arrayBuffer(): PromiseLike<ArrayBuffer>;
}

export async function digestImportedVideoFile(file: unknown): Promise<string> {
	if (file instanceof Blob) return digestMediaContent(file);
	return digestMediaContent(new Blob([await importByteSource(file).arrayBuffer()]));
}

export async function publishImportedVideo(
	store: ImportedVideoPublicationStore,
	storageKey: string,
	file: unknown,
	metadata: Readonly<Record<string, unknown>>,
	signal?: AbortSignal,
): Promise<Readonly<{ sha256: string; publication: OwnedMediaAssetPublication }>> {
	const source = file instanceof Blob ? null : importByteSource(file);
	const body = file instanceof Blob
		? file
		: new Blob([await source!.arrayBuffer()], { type: typeof source!.type === 'string' ? source!.type : '' });
	if (!body.size) throw new RangeError('Video media must contain at least one byte.');
	const sha256 = await digestMediaContent(body);
	const writer = await store.beginMediaAssetWrite(storageKey, metadata, {
		expectedBytes: body.size,
		expectedSha256: sha256,
		signal,
	});
	let publication: OwnedMediaAssetPublication | null = null;
	try {
		const maximumChunkBytes = positiveWriterChunkBytes(writer.maximumChunkBytes);
		for (let offset = 0; offset < body.size; offset += maximumChunkBytes) {
			throwIfImportAborted(signal);
			const end = Math.min(offset + maximumChunkBytes, body.size);
			const bytes = new Uint8Array(await body.slice(offset, end).arrayBuffer());
			if (bytes.byteLength !== end - offset) throw new Error('Video media returned an incomplete byte range.');
			await writer.write(bytes, { signal });
		}
		if (writer.bytesWritten !== body.size) throw new Error('Video media emitted an unexpected byte length.');
		publication = await writer.commitOwned({ signal });
		throwIfImportAborted(signal);
		if (!publication || typeof publication.discardIfCurrent !== 'function'
			|| publication.metadata.sha256 !== sha256 || publication.metadata.size !== body.size) {
			throw new Error('Published video metadata disagrees with its admitted content.');
		}
		return Object.freeze({ sha256, publication });
	} catch (error) {
		let cleanupError: unknown;
		try {
			if (publication) await publication.discardIfCurrent();
			else await writer.abort();
		} catch (failure) {
			cleanupError = failure;
		}
		if (cleanupError !== undefined) {
			throw new AggregateError([error, cleanupError], 'Video publication and cleanup both failed.', { cause: error });
		}
		throw error;
	}
}

function importByteSource(value: unknown): ImportByteSource {
	if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'arrayBuffer') !== 'function') {
		throw new TypeError('Video media must provide bytes for digest binding.');
	}
	return value as ImportByteSource;
}

function positiveWriterChunkBytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('The video media writer has an invalid chunk bound.');
	}
	return Number(value);
}

function throwIfImportAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video import was cancelled.', 'AbortError');
}
