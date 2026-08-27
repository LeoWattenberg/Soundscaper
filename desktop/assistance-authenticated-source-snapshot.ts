/* SPDX-License-Identifier: AGPL-3.0-only */

/** Disposable, main-owned copy of one already-claimed assistance source. */

import { createHash } from 'node:crypto';
import { mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

export interface AssistanceAuthenticatedSourceIdentityV1 {
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AssistanceAuthenticatedSourceSnapshotV1 extends
	AssistanceAuthenticatedSourceIdentityV1 {
	readonly path: string;
	dispose(): Promise<void>;
}

const SHA256 = /^[a-f\d]{64}$/u;
const COPY_CHUNK_BYTES = 1024 * 1024;

export async function snapshotAssistanceAuthenticatedSourceV1(
	sourcePath: string,
	identityValue: AssistanceAuthenticatedSourceIdentityV1,
	signal: AbortSignal,
): Promise<AssistanceAuthenticatedSourceSnapshotV1> {
	const identity = validateIdentity(identityValue);
	if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath) || sourcePath.includes('\0')) {
		throw new TypeError('Authenticated assistance source paths must be absolute files.');
	}
	const directory = await mkdtemp(join(dirname(sourcePath), '.soundscaper-source-snapshot-'));
	const snapshotPath = join(directory, 'source.input');
	try {
		await copyExactSource(sourcePath, snapshotPath, identity, signal);
		if (!await assistanceSourceMatchesIdentityV1(snapshotPath, identity, signal)) {
			throw new Error('The disposable assistance source snapshot failed authentication.');
		}
	} catch (error) {
		await removeSnapshot(snapshotPath, directory);
		throw error;
	}
	let disposed = false;
	return Object.freeze({ path: snapshotPath, ...identity, async dispose() {
		if (disposed) return;
		await removeSnapshot(snapshotPath, directory);
		disposed = true;
	} });
}

export async function assistanceSourceMatchesIdentityV1(
	path: string,
	identityValue: AssistanceAuthenticatedSourceIdentityV1,
	signal: AbortSignal,
): Promise<boolean> {
	const identity = validateIdentity(identityValue);
	let handle;
	try { handle = await open(path, 'r'); } catch { return false; }
	try {
		signal.throwIfAborted();
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size !== identity.byteLength) return false;
		const hash = createHash('sha256');
		let offset = 0;
		while (offset < identity.byteLength) {
			signal.throwIfAborted();
			const chunk = new Uint8Array(Math.min(COPY_CHUNK_BYTES, identity.byteLength - offset));
			const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
			if (bytesRead < 1) return false;
			hash.update(chunk.subarray(0, bytesRead));
			offset += bytesRead;
		}
		if ((await handle.read(new Uint8Array(1), 0, 1, identity.byteLength)).bytesRead !== 0) {
			return false;
		}
		return hash.digest('hex') === identity.sha256;
	} finally { await handle.close(); }
}

async function copyExactSource(
	sourcePath: string,
	snapshotPath: string,
	identity: AssistanceAuthenticatedSourceIdentityV1,
	signal: AbortSignal,
): Promise<void> {
	const source = await open(sourcePath, 'r');
	let destination: Awaited<ReturnType<typeof open>> | null = null;
	try {
		destination = await open(snapshotPath, 'wx', 0o600);
		signal.throwIfAborted();
		const metadata = await source.stat();
		if (!metadata.isFile() || metadata.size !== identity.byteLength) {
			throw new Error('The authenticated assistance source length changed.');
		}
		const hash = createHash('sha256');
		let offset = 0;
		while (offset < identity.byteLength) {
			signal.throwIfAborted();
			const chunk = new Uint8Array(Math.min(COPY_CHUNK_BYTES, identity.byteLength - offset));
			const { bytesRead } = await source.read(chunk, 0, chunk.byteLength, offset);
			if (bytesRead < 1) throw new Error('The authenticated assistance source ended early.');
			const body = chunk.subarray(0, bytesRead);
			hash.update(body);
			let written = 0;
			while (written < body.byteLength) {
				const result = await destination.write(body, written, body.byteLength - written,
					offset + written);
				if (result.bytesWritten < 1) throw new Error('The assistance snapshot write made no progress.');
				written += result.bytesWritten;
			}
			offset += bytesRead;
		}
		if ((await source.read(new Uint8Array(1), 0, 1, identity.byteLength)).bytesRead !== 0
			|| hash.digest('hex') !== identity.sha256) {
			throw new Error('The authenticated assistance source digest changed.');
		}
		await destination.sync();
	} finally {
		await destination?.close();
		await source.close();
	}
}

function validateIdentity(
	value: AssistanceAuthenticatedSourceIdentityV1,
): AssistanceAuthenticatedSourceIdentityV1 {
	if (!value || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| !SHA256.test(value.sha256)) {
		throw new TypeError('Authenticated assistance source identity is invalid.');
	}
	return Object.freeze({ byteLength: value.byteLength, sha256: value.sha256 });
}

async function removeSnapshot(path: string, directory: string): Promise<void> {
	try { await unlink(path); } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	try { await rmdir(directory); } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}
