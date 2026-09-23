/* SPDX-License-Identifier: AGPL-3.0-only */

/** Streaming extraction of the exact pinned, regular-file USTAR runtime closure. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';

export interface AssistanceRuntimeArchiveFile {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly executable: boolean;
}

class ExactStreamReader {
	readonly #iterator: AsyncIterator<Buffer>;
	#buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	#offset = 0;

	constructor(stream: AsyncIterable<Buffer>) {
		this.#iterator = stream[Symbol.asyncIterator]();
	}

	async read(length: number): Promise<Buffer> {
		const parts: Buffer[] = [];
		let remaining = length;
		while (remaining > 0) {
			if (this.#offset === this.#buffer.length) {
				const next = await this.#iterator.next();
				if (next.done) throw new Error('The runtime archive ended early.');
				this.#buffer = next.value;
				this.#offset = 0;
				continue;
			}
			const count = Math.min(remaining, this.#buffer.length - this.#offset);
			parts.push(this.#buffer.subarray(this.#offset, this.#offset + count));
			this.#offset += count;
			remaining -= count;
		}
		return parts.length === 1 ? parts[0]! : Buffer.concat(parts, length);
	}

	async exhausted(): Promise<boolean> {
		if (this.#offset < this.#buffer.length) return false;
		return (await this.#iterator.next()).done === true;
	}
}

function headerText(header: Buffer, start: number, length: number): string {
	const field = header.subarray(start, start + length);
	const end = field.indexOf(0);
	return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

function octal(header: Buffer, start: number, length: number): number {
	const value = headerText(header, start, length).trim();
	if (!/^[0-7]+$/u.test(value)) throw new Error('The runtime archive has an invalid USTAR number.');
	const number = Number.parseInt(value, 8);
	if (!Number.isSafeInteger(number)) throw new Error('The runtime archive has an excessive USTAR number.');
	return number;
}

function entry(header: Buffer): { path: string; size: number } {
	const checksum = octal(header, 148, 8);
	let sum = 0;
	for (let index = 0; index < 512; index++) {
		sum += index >= 148 && index < 156 ? 32 : header[index]!;
	}
	if (sum !== checksum || headerText(header, 257, 6) !== 'ustar'
		|| headerText(header, 263, 2) !== '00'
		|| header[156] !== 0 && header[156] !== 48) {
		throw new Error('The runtime archive has an invalid or non-regular USTAR entry.');
	}
	const name = headerText(header, 0, 100);
	const prefix = headerText(header, 345, 155);
	return { path: prefix ? `${prefix}/${name}` : name, size: octal(header, 124, 12) };
}

/** The archive digest is checked before this function is called. */
export async function extractAssistanceRuntimeArchive(
	archivePath: string,
	destination: string,
	files: readonly AssistanceRuntimeArchiveFile[],
	signal?: AbortSignal,
): Promise<void> {
	const stream = createReadStream(archivePath).pipe(createGunzip());
	const reader = new ExactStreamReader(stream);
	try {
		for (const file of files) {
			signal?.throwIfAborted();
			const item = entry(await reader.read(512));
			if (item.path !== file.path || item.size !== file.byteLength) {
				throw new Error('The runtime archive file inventory differs from its pinned manifest.');
			}
			const target = resolve(destination, file.path);
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			const handle = await open(target, 'wx', 0o600);
			const hash = createHash('sha256');
			try {
				let remaining = file.byteLength;
				while (remaining > 0) {
					signal?.throwIfAborted();
					const bytes = await reader.read(Math.min(remaining, 64 * 1024));
					await handle.write(bytes);
					hash.update(bytes);
					remaining -= bytes.length;
				}
				await handle.sync();
			} finally {
				await handle.close();
			}
			if (hash.digest('hex') !== file.sha256) {
				throw new Error(`The runtime archive file ${file.path} failed its digest check.`);
			}
			if (file.executable) await chmod(target, 0o700);
			const padding = (512 - file.byteLength % 512) % 512;
			if (padding > 0 && (await reader.read(padding)).some((byte) => byte !== 0)) {
				throw new Error('The runtime archive contains nonzero padding.');
			}
		}
		for (let count = 0; count < 2; count++) {
			if ((await reader.read(512)).some((byte) => byte !== 0)) {
				throw new Error('The runtime archive contains an unlisted entry.');
			}
		}
		if (!await reader.exhausted()) throw new Error('The runtime archive has trailing data.');
	} finally {
		stream.destroy();
	}
}
