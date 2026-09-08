/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Readable } from 'node:stream';

export const DELIVERY_FILESYSTEM_MAGIC = Buffer.from('SDF1');
export const DELIVERY_FILESYSTEM_VERSION = 1;
export const DELIVERY_FILESYSTEM_HEADER_BYTES = 16;
export const DELIVERY_FILESYSTEM_MAXIMUM_CONTROL_BYTES = 64 * 1024;

export interface DeliveryFilesystemFrame {
	readonly opcode: number;
	readonly requestId: number;
	readonly payload: Buffer;
}

export class DeliveryFilesystemFrameReader {
	#buffer = Buffer.alloc(0);
	#waiting: (() => void) | null = null;
	#error: Error | null = null;

	constructor(stream: Readable) {
		stream.on('data', (chunk: Buffer) => {
			if (this.#error !== null) return;
			const bytes = Buffer.from(chunk);
			if (this.#buffer.byteLength
				+ bytes.byteLength > DELIVERY_FILESYSTEM_MAXIMUM_CONTROL_BYTES + DELIVERY_FILESYSTEM_HEADER_BYTES) {
				this.#error = new Error('Soundscaper delivery helper exceeded its response bound.');
				stream.destroy();
			} else this.#buffer = Buffer.concat([this.#buffer, bytes]);
			this.#waiting?.();
		});
		stream.on('end', () => {
			this.#error ??= new Error('Soundscaper delivery helper closed unexpectedly.');
			this.#waiting?.();
		});
		stream.on('error', (error) => { this.#error = error; this.#waiting?.(); });
	}

	fail(error: Error): void {
		this.#error = error;
		this.#waiting?.();
	}

	async read(): Promise<DeliveryFilesystemFrame> {
		while (this.#buffer.byteLength < DELIVERY_FILESYSTEM_HEADER_BYTES) await this.#more();
		const header = this.#buffer.subarray(0, DELIVERY_FILESYSTEM_HEADER_BYTES);
		if (!header.subarray(0, 4).equals(DELIVERY_FILESYSTEM_MAGIC)
			|| header[4] !== DELIVERY_FILESYSTEM_VERSION || header[6] !== 0 || header[7] !== 0) {
			throw new Error('Soundscaper delivery helper returned a malformed frame header.');
		}
		const length = header.readUInt32BE(12);
		if (length > DELIVERY_FILESYSTEM_MAXIMUM_CONTROL_BYTES) {
			throw new Error('Soundscaper delivery helper response is too large.');
		}
		while (this.#buffer.byteLength < DELIVERY_FILESYSTEM_HEADER_BYTES + length) await this.#more();
		const frame = Object.freeze({
			opcode: header[5]!, requestId: header.readUInt32BE(8),
			payload: Buffer.from(this.#buffer.subarray(
				DELIVERY_FILESYSTEM_HEADER_BYTES,
				DELIVERY_FILESYSTEM_HEADER_BYTES + length,
			)),
		});
		this.#buffer = this.#buffer.subarray(DELIVERY_FILESYSTEM_HEADER_BYTES + length);
		return frame;
	}

	async #more(): Promise<void> {
		if (this.#error) throw this.#error;
		await new Promise<void>((resolve) => { this.#waiting = resolve; });
		this.#waiting = null;
		if (this.#error) throw this.#error;
	}
}
