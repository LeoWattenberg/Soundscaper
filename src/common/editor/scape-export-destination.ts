/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobWriter } from '@zip.js/zip.js';

import { aggregateScapeErrors, throwIfScapeAborted } from './scape-abort.ts';

interface ScapeZipWriter {
	close(comment?: Uint8Array, options?: Readonly<{ zip64?: boolean; preventClose?: boolean }>): Promise<unknown>;
}

export interface ScapeExportDestination {
	readonly target: BlobWriter | WritableStream<Uint8Array>;
	finish(writer: ScapeZipWriter, signal?: AbortSignal): Promise<Blob | null>;
	abort(writer: ScapeZipWriter, primary: unknown): Promise<never>;
}

export function createScapeExportDestination(
	writable: WritableStream<Uint8Array> | undefined,
	mimeType: string,
): ScapeExportDestination {
	return writable
		? new ExternalScapeExportDestination(writable)
		: new BlobScapeExportDestination(mimeType);
}

class BlobScapeExportDestination implements ScapeExportDestination {
	readonly target: BlobWriter;

	constructor(mimeType: string) {
		this.target = new BlobWriter(mimeType);
	}

	async finish(writer: ScapeZipWriter, signal?: AbortSignal): Promise<Blob> {
		throwIfScapeAborted(signal);
		const result = await writer.close(undefined, { zip64: true });
		throwIfScapeAborted(signal);
		if (!(result instanceof Blob)) throw new TypeError('The .scape archive writer did not produce a Blob.');
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
	#released = false;

	constructor(writable: WritableStream<Uint8Array>) {
		this.#writer = writable.getWriter();
		this.target = new WritableStream<Uint8Array>({
			write: (chunk) => this.#writer.write(chunk),
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

	#release(): void {
		if (this.#released) return;
		this.#released = true;
		this.#writer.releaseLock();
	}
}
