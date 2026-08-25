/* SPDX-License-Identifier: AGPL-3.0-only */

/** Private filesystem and abort primitives owned by the assistance staging registry. */

import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';

export interface AssistanceStagingFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

export interface AssistanceStagingLinkedSignal {
	readonly signal: AbortSignal;
	dispose(): void;
}

export interface AssistanceStagingAuthenticatedFile {
	readonly byteLength: number;
	readonly sha256: string;
}

interface AssistanceStagingMetadata {
	readonly dev: number; readonly ino: number; readonly mode: number; readonly size: number;
	isFile(): boolean; isSymbolicLink(): boolean;
}

export async function authenticateAssistanceStagingFile(
	path: string,
	identity: AssistanceStagingFileIdentity,
	options: Readonly<{
		minimumByteLength: number;
		maximumByteLength: number;
		expectedSha256: string | null;
		signal: AbortSignal;
		label: string;
	}>,
): Promise<AssistanceStagingAuthenticatedFile> {
	options.signal.throwIfAborted();
	const handle = await openPrivateRead(path);
	try {
		const before = await handle.stat();
		assertPrivateFileRange(before, options.minimumByteLength, options.maximumByteLength, options.label);
		if (!sameAssistanceStagingIdentity(identity, assistanceStagingFileIdentity(before))) {
			throw new Error(`The ${options.label} changed identity.`);
		}
		const digest = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, before.size)));
		let position = 0;
		while (position < before.size) {
			options.signal.throwIfAborted();
			const length = Math.min(buffer.byteLength, before.size - position);
			const { bytesRead } = await handle.read(buffer, 0, length, position);
			if (bytesRead < 1) throw new Error(`The ${options.label} ended before its registered length.`);
			digest.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		options.signal.throwIfAborted();
		const after = await handle.stat();
		if (!sameAssistanceStagingIdentity(identity, assistanceStagingFileIdentity(after))
			|| after.size !== before.size) {
			throw new Error(`The ${options.label} changed while it was authenticated.`);
		}
		const sha256 = digest.digest('hex');
		if (options.expectedSha256 !== null && sha256 !== options.expectedSha256) {
			throw new Error(`The ${options.label} digest does not match its registered claim.`);
		}
		await assertAssistanceStagingPathIdentity(path, identity, before.size, options.label);
		return Object.freeze({ byteLength: before.size, sha256 });
	} finally {
		await handle.close();
	}
}

export async function createAssistanceStagingPrivateFile(path: string): Promise<FileHandle> {
	const noFollow = process.platform === 'win32' ? 0 : fileConstants.O_NOFOLLOW;
	return open(path, fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_WRONLY | noFollow, 0o600);
}

export async function writeAssistanceStagingBytes(handle: FileHandle, bytes: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
		if (bytesWritten < 1) throw new Error('Assistance staging could not write its exact input bytes.');
		offset += bytesWritten;
	}
}

export async function privateAssistanceStagingDirectoryIdentity(
	path: string,
	label: string,
): Promise<AssistanceStagingFileIdentity> {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || !privateMode(metadata.mode, 0o700)) {
		throw new Error(`The ${label} must be one private 0700 regular directory.`);
	}
	return assistanceStagingFileIdentity(metadata);
}

export async function assertAssistanceStagingPathIdentity(
	path: string,
	identity: AssistanceStagingFileIdentity,
	byteLength: number,
	label: string,
): Promise<void> {
	const metadata = await lstat(path);
	assertPrivateFileRange(metadata, byteLength, byteLength, label);
	if (!sameAssistanceStagingIdentity(identity, assistanceStagingFileIdentity(metadata))) {
		throw new Error(`The ${label} changed identity.`);
	}
}

export function assertAssistanceStagingPrivateFile(
	metadata: AssistanceStagingMetadata,
	byteLength: number,
	label: string,
): void {
	assertPrivateFileRange(metadata, byteLength, byteLength, label);
}

export function assistanceStagingFileIdentity(
	metadata: Readonly<{ dev: number; ino: number }>,
): AssistanceStagingFileIdentity {
	return Object.freeze({ dev: metadata.dev, ino: metadata.ino });
}

export function sameAssistanceStagingIdentity(
	left: AssistanceStagingFileIdentity,
	right: AssistanceStagingFileIdentity,
): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

export function ownedAssistanceStagingChunk(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximum) {
		throw new RangeError('An assistance staging chunk is empty or exceeds its byte bound.');
	}
	return new Uint8Array(value);
}

export function nextAssistanceStagingChunk(
	iterator: AsyncIterator<Uint8Array>,
	signal: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
	signal.throwIfAborted();
	let next: Promise<IteratorResult<Uint8Array>>;
	try { next = Promise.resolve(iterator.next()); }
	catch (error) { return Promise.reject(error); }
	return new Promise((resolveNext, rejectNext) => {
		let settled = false;
		const abort = (): void => {
			if (settled) return;
			settled = true;
			rejectNext(signal.reason ?? new DOMException('Assistance staging was cancelled.', 'AbortError'));
		};
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		void next.then(
			(value) => {
				signal.removeEventListener('abort', abort);
				if (settled) return;
				settled = true;
				resolveNext(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', abort);
				if (settled) return;
				settled = true;
				rejectNext(error);
			},
		);
	});
}

export function closeAssistanceStagingIterator(iterator: AsyncIterator<Uint8Array>): void {
	if (typeof iterator.return !== 'function') return;
	try { void Promise.resolve(iterator.return()).catch(() => undefined); }
	catch { /* The private file is still removed by the registry. */ }
}

export function linkAssistanceStagingSignals(
	external: AbortSignal | undefined,
	job: AbortSignal,
): AssistanceStagingLinkedSignal {
	if (!external) return Object.freeze({ signal: job, dispose() {} });
	const controller = new AbortController();
	const fromExternal = (): void => controller.abort(external.reason);
	const fromJob = (): void => controller.abort(job.reason);
	if (external.aborted) fromExternal();
	else external.addEventListener('abort', fromExternal, { once: true });
	if (job.aborted) fromJob();
	else job.addEventListener('abort', fromJob, { once: true });
	return Object.freeze({
		signal: controller.signal,
		dispose(): void {
			external.removeEventListener('abort', fromExternal);
			job.removeEventListener('abort', fromJob);
		},
	});
}

function openPrivateRead(path: string): Promise<FileHandle> {
	const noFollow = process.platform === 'win32' ? 0 : fileConstants.O_NOFOLLOW;
	return open(path, fileConstants.O_RDONLY | noFollow);
}

function assertPrivateFileRange(
	metadata: AssistanceStagingMetadata,
	minimumByteLength: number,
	maximumByteLength: number,
	label: string,
): void {
	if (!metadata.isFile() || metadata.isSymbolicLink() || !privateMode(metadata.mode, 0o600)
		|| metadata.size < minimumByteLength || metadata.size > maximumByteLength) {
		throw new Error(`The ${label} is not a private regular file within its exact byte bound.`);
	}
}

function privateMode(mode: number, expected: number): boolean {
	return process.platform === 'win32' || (mode & 0o777) === expected;
}
