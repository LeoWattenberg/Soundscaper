/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobWriter } from '@zip.js/zip.js';

import { aggregateScapeErrors, throwIfScapeAborted } from './scape-abort.ts';

interface ScapeZipWriter {
	close(comment?: Uint8Array, options?: Readonly<{ zip64?: boolean; preventClose?: boolean }>): Promise<unknown>;
}

export const SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;

export interface ScapeExportDestination {
	readonly target: BlobWriter | WritableStream<Uint8Array>;
	readonly byteLength: number;
	finish(writer: ScapeZipWriter, signal?: AbortSignal): Promise<Blob | null>;
	abort(writer: ScapeZipWriter, primary: unknown): Promise<never>;
}

export function createScapeExportDestination(
	writable: WritableStream<Uint8Array> | undefined,
	mimeType: string,
	maximumBytes: number,
): ScapeExportDestination {
	return writable
		? new ExternalScapeExportDestination(writable, maximumBytes)
		: new BlobScapeExportDestination(mimeType);
}

class BlobScapeExportDestination implements ScapeExportDestination {
	readonly target: BlobWriter;
	#byteLength = 0;

	get byteLength(): number {
		return this.#byteLength;
	}

	constructor(mimeType: string) {
		this.target = new BlobWriter(mimeType);
	}

	async finish(writer: ScapeZipWriter, signal?: AbortSignal): Promise<Blob> {
		throwIfScapeAborted(signal);
		const result = await writer.close(undefined, { zip64: true });
		throwIfScapeAborted(signal);
		if (!(result instanceof Blob)) throw new TypeError('The .scape archive writer did not produce a Blob.');
		this.#byteLength = result.size;
		return result;
	}

	async abort(writer: ScapeZipWriter, primary: unknown): Promise<never> {
		const cleanupErrors: unknown[] = [];
		try {
			await writer.close(undefined, { zip64: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
		throw aggregateScapeErrors(primary, cleanupErrors, 'The .scape export and archive cleanup both failed.');
	}
}

class ExternalScapeExportDestination implements ScapeExportDestination {
	readonly target: WritableStream<Uint8Array>;
	readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
	readonly #maximumBytes: number;
	#byteLength = 0;
	#released = false;

	get byteLength(): number {
		return this.#byteLength;
	}

	constructor(writable: WritableStream<Uint8Array>, maximumBytes: number) {
		if (!writable || typeof writable.getWriter !== 'function') {
			throw new TypeError('A writable Scape destination is required.');
		}
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
			throw new RangeError('The Scape destination maximum must be a non-negative safe integer.');
		}
		this.#maximumBytes = maximumBytes;
		this.#writer = writable.getWriter();
		this.target = new WritableStream<Uint8Array>({
			write: (chunk) => this.#write(chunk),
		});
	}

	async finish(writer: ScapeZipWriter, signal?: AbortSignal): Promise<null> {
		throwIfScapeAborted(signal);
		await writer.close(undefined, { zip64: true, preventClose: true });
		throwIfScapeAborted(signal);
		await this.#writer.close();
		this.#release();
		return null;
	}

	async abort(writer: ScapeZipWriter, primary: unknown): Promise<never> {
		const cleanupErrors: unknown[] = [];
		try {
			await this.#writer.abort(primary);
		} catch (error) {
			cleanupErrors.push(error);
		}
		try {
			await writer.close(undefined, { zip64: true, preventClose: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
		this.#release();
		throw aggregateScapeErrors(primary, cleanupErrors, 'The .scape export and destination cleanup both failed.');
	}

	async #write(value: Uint8Array): Promise<void> {
		const bytes = toBytes(value);
		if (bytes.byteLength > this.#maximumBytes - this.#byteLength) {
			throw new RangeError('The Scape output exceeds its admitted maximum.');
		}
		for (let offset = 0; offset < bytes.byteLength; offset += SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES) {
			const chunk = bytes.subarray(offset, offset + SCAPE_EXPORT_MAXIMUM_CHUNK_BYTES);
			await this.#writer.write(chunk);
			this.#byteLength += chunk.byteLength;
		}
	}

	#release(): void {
		if (this.#released) return;
		this.#released = true;
		this.#writer.releaseLock();
	}
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A .scape archive writer emitted a non-byte chunk.');
}
