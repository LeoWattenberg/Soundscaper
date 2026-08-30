/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded main-private copy from content-addressed project storage into helper scratch. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink, type FileHandle } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/u;
const CHUNK_BYTES = 1024 * 1024;

export interface ProjectLibraryNativeBodyIdentity {
	readonly byteLength: number;
	readonly sha256: string;
}

interface VerifiedBodyClaim {
	readonly handle: FileHandle;
	readonly identity: ProjectLibraryNativeBodyIdentity;
	readonly file: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>;
}

/** Session-scoped range reader over one authenticated, retained file identity. */
export class ProjectLibraryVerifiedBodyReader {
	readonly #claims = new Map<string, VerifiedBodyClaim>();

	async read(
		sourceValue: string,
		identityValue: ProjectLibraryNativeBodyIdentity,
		offset: number,
		length: number,
		maximumLength: number,
	): Promise<Uint8Array> {
		const source = absolute(sourceValue, 'managed body');
		const identity = exactIdentity(identityValue);
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length)
			|| length < 1 || !Number.isSafeInteger(maximumLength) || maximumLength < 1
			|| length > maximumLength || offset > identity.byteLength - length) {
			throw new RangeError('The managed project body range is invalid.');
		}
		let claim = this.#claims.get(source);
		if (claim && (claim.identity.byteLength !== identity.byteLength
			|| claim.identity.sha256 !== identity.sha256)) {
			throw new Error('The managed project body claim changed declared identity.');
		}
		if (!claim) {
			claim = await openVerifiedProjectLibraryBody(source, identity);
			this.#claims.set(source, claim);
		}
		const current = await claim.handle.stat();
		if (!sameFileIdentity(claim.file, current)) {
			this.#claims.delete(source);
			await claim.handle.close().catch(() => undefined);
			throw new Error('The managed project body changed after authentication.');
		}
		const bytes = new Uint8Array(length);
		const observed = await claim.handle.read(bytes, 0, length, offset);
		if (observed.bytesRead !== length) throw new Error('The managed project body ended early.');
		return bytes;
	}

	async close(): Promise<void> {
		const claims = [...this.#claims.values()];
		this.#claims.clear();
		const results = await Promise.allSettled(claims.map(({ handle }) => handle.close()));
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failures.length) throw new AggregateError(failures.map(({ reason }) => reason),
			'Managed project body reader cleanup failed.');
	}
}

export async function verifyProjectLibraryNativeBody(
	sourceValue: string,
	identityValue: ProjectLibraryNativeBodyIdentity,
	signal?: AbortSignal,
): Promise<ProjectLibraryNativeBodyIdentity> {
	const claim = await openVerifiedProjectLibraryBody(
		absolute(sourceValue, 'managed body'), exactIdentity(identityValue), signal,
	);
	await claim.handle.close();
	return claim.identity;
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

async function openVerifiedProjectLibraryBody(
	source: string,
	identity: ProjectLibraryNativeBodyIdentity,
	signal?: AbortSignal,
): Promise<VerifiedBodyClaim> {
	const before = await lstat(source);
	if (!before.isFile() || before.isSymbolicLink() || before.size !== identity.byteLength) {
		throw new Error('The managed project body changed type or length.');
	}
	const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
			|| opened.size !== identity.byteLength) throw new Error('The managed project body changed identity.');
		const hash = createHash('sha256');
		const chunk = new Uint8Array(CHUNK_BYTES);
		for (let offset = 0; offset < identity.byteLength;) {
			throwIfAborted(signal);
			const length = Math.min(chunk.byteLength, identity.byteLength - offset);
			const observed = await handle.read(chunk, 0, length, offset);
			if (observed.bytesRead !== length) throw new Error('The managed project body ended early.');
			hash.update(chunk.subarray(0, length));
			offset += length;
		}
		const after = await handle.stat();
		if (!sameFileIdentity(opened, after)) throw new Error('The managed project body changed while hashing.');
		if (hash.digest('hex') !== identity.sha256) throw new Error('The managed project body changed digest.');
		return Object.freeze({ handle, identity: Object.freeze({ ...identity }), file: fileIdentity(after) });
	} catch (error) {
		await handle.close().catch(() => undefined);
		throw error;
	}
}

function exactIdentity(value: ProjectLibraryNativeBodyIdentity): ProjectLibraryNativeBodyIdentity {
	if (!Number.isSafeInteger(value?.byteLength) || value.byteLength < 1 || !SHA256.test(value.sha256)) {
		throw new TypeError('A managed project body requires exact identity.');
	}
	return value;
}

function fileIdentity(value: Readonly<{
	dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number;
}>): VerifiedBodyClaim['file'] {
	return Object.freeze({ dev: value.dev, ino: value.ino, size: value.size,
		mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });
}

function sameFileIdentity(
	left: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>,
	right: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }>,
): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeMs === right.mtimeMs;
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
