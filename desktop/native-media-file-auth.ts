/* SPDX-License-Identifier: AGPL-3.0-only */

/** Handle-bound file identity, length, and digest authentication for media jobs. */

import { constants, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';

export interface NativeMediaAuthenticatedFile {
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<{ dev: number; ino: number }>;
}

export interface NativeMediaFileAuthentication {
	readonly path: string;
	readonly byteLength?: number;
	readonly maximumBytes?: number;
	readonly sha256?: string;
	readonly identity?: Readonly<{ dev: number; ino: number }>;
}

export async function authenticateNativeMediaFile(
	request: NativeMediaFileAuthentication,
): Promise<NativeMediaAuthenticatedFile> {
	const before = await lstat(request.path);
	if (!before.isFile() || before.isSymbolicLink()) throw invalid();
	const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
	const handle = await open(request.path, constants.O_RDONLY | noFollow);
	try {
		const opened = await handle.stat();
		assertSameFile(before, opened);
		if (request.byteLength !== undefined && opened.size !== request.byteLength) throw invalid();
		if (request.maximumBytes !== undefined && opened.size > request.maximumBytes) throw invalid();
		if (request.byteLength === undefined && request.maximumBytes === undefined) throw invalid();
		if (request.identity && (opened.dev !== request.identity.dev || opened.ino !== request.identity.ino)) {
			throw invalid();
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(16 * 1024 * 1024);
		let offset = 0;
		for (;;) {
			const read = await handle.read(buffer, 0, buffer.byteLength, offset);
			if (read.bytesRead === 0) break;
			hash.update(buffer.subarray(0, read.bytesRead));
			offset += read.bytesRead;
		}
		const sha256 = hash.digest('hex');
		if (request.sha256 !== undefined && sha256 !== request.sha256) throw invalid();
		assertSameFile(opened, await lstat(request.path));
		return Object.freeze({
			byteLength: opened.size, sha256,
			identity: Object.freeze({ dev: opened.dev, ino: opened.ino }),
		});
	} finally {
		await handle.close();
	}
}

function assertSameFile(left: Stats, right: Stats): void {
	if (!right.isFile() || right.isSymbolicLink() || left.dev !== right.dev || left.ino !== right.ino) {
		throw invalid();
	}
}

function invalid(): Error {
	return new Error('A native media file no longer matches its authenticated identity, length, or digest.');
}
