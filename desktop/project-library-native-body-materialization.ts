/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded main-private copy from content-addressed project storage into helper scratch. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/u;
const CHUNK_BYTES = 1024 * 1024;

export interface ProjectLibraryNativeBodyIdentity {
	readonly byteLength: number;
	readonly sha256: string;
}

/** Never retains more than one 1 MiB body chunk in the main process. */
export async function materializeProjectLibraryNativeBody(
	sourceValue: string,
	destinationValue: string,
	identity: ProjectLibraryNativeBodyIdentity,
	signal?: AbortSignal,
): Promise<ProjectLibraryNativeBodyIdentity> {
	const source = absolute(sourceValue, 'managed body');
	const destination = absolute(destinationValue, 'helper scratch body');
	if (source === destination || !Number.isSafeInteger(identity.byteLength)
		|| identity.byteLength < 1 || !SHA256.test(identity.sha256)) {
		throw new TypeError('Native body materialization requires distinct paths and exact identity.');
	}
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Native body materialization received an invalid cancellation signal.');
	}
	const before = await lstat(source);
	if (!before.isFile() || before.isSymbolicLink() || before.size !== identity.byteLength) {
		throw new Error('The managed project body changed type or length.');
	}
	const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	let output: Awaited<ReturnType<typeof open>> | null = null;
	const chunk = new Uint8Array(CHUNK_BYTES);
	try {
		const opened = await input.stat();
		if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
			|| opened.size !== identity.byteLength) throw new Error('The managed project body changed identity.');
		output = await open(destination, 'wx', 0o600);
		const hash = createHash('sha256');
		for (let offset = 0; offset < identity.byteLength;) {
			throwIfAborted(signal);
			const length = Math.min(chunk.byteLength, identity.byteLength - offset);
			const observed = await input.read(chunk, 0, length, offset);
			if (observed.bytesRead !== length) throw new Error('The managed project body ended early.');
			const bytes = chunk.subarray(0, length);
			hash.update(bytes);
			for (let written = 0; written < length;) {
				const result = await output.write(bytes, written, length - written, offset + written);
				if (result.bytesWritten < 1) throw new Error('The helper scratch body stopped accepting bytes.');
				written += result.bytesWritten;
			}
			offset += length;
		}
		throwIfAborted(signal);
		if (hash.digest('hex') !== identity.sha256) throw new Error('The managed project body changed digest.');
		await output.sync();
		return Object.freeze({ byteLength: identity.byteLength, sha256: identity.sha256 });
	} catch (error) {
		await output?.close().catch(() => undefined);
		output = null;
		await unlink(destination).catch(() => undefined);
		throw error;
	} finally {
		chunk.fill(0);
		await input.close();
		await output?.close();
	}
}

function absolute(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)
		|| normalize(value) !== value) throw new TypeError(`The ${label} path is invalid.`);
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason
		?? new DOMException('Native body materialization was cancelled.', 'AbortError');
}
