/* SPDX-License-Identifier: AGPL-3.0-only */

/** Handle-held filesystem identity fences for native media helper jobs. */

import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
	lstat, open, rm, type FileHandle,
} from 'node:fs/promises';

export interface NativeMediaFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

export interface NativeMediaAuthenticatedFile {
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<NativeMediaFileIdentity>;
}

export interface NativeMediaFileAuthentication {
	readonly path: string;
	readonly byteLength?: number;
	readonly maximumBytes?: number;
	readonly sha256?: string;
	readonly identity?: Readonly<NativeMediaFileIdentity>;
}

export interface NativeMediaDirectoryAuthentication {
	readonly path: string;
	readonly identity?: Readonly<NativeMediaFileIdentity>;
}

export interface NativeMediaFileLease {
	readonly path: string;
	readonly authenticated: Readonly<NativeMediaAuthenticatedFile>;
	revalidate(): Promise<void>;
	close(): Promise<void>;
}

export interface NativeMediaDirectoryLease {
	readonly path: string;
	readonly identity: Readonly<NativeMediaFileIdentity>;
	revalidate(): Promise<void>;
	close(): Promise<void>;
}

export async function acquireNativeMediaFileLease(
	request: NativeMediaFileAuthentication,
): Promise<NativeMediaFileLease> {
	assertFileBound(request);
	const before = await lstat(request.path);
	if (!before.isFile() || before.isSymbolicLink()) throw invalidFile();
	const handle = await open(request.path, readOnlyNoFollowFlags());
	try {
		const opened = await handle.stat();
		assertSameFile(before, opened);
		assertRequestedFile(opened, request);
		const sha256 = await digestStableHandle(handle, opened);
		if (request.sha256 !== undefined && sha256 !== request.sha256) throw invalidFile();
		assertSameFile(opened, await lstat(request.path));
		return new HeldFileLease(request.path, handle, opened, sha256);
	} catch (error) {
		await handle.close().catch(() => undefined);
		throw error;
	}
}

export async function acquireNativeMediaDirectoryLease(
	request: NativeMediaDirectoryAuthentication,
): Promise<NativeMediaDirectoryLease> {
	const before = await lstat(request.path);
	if (!before.isDirectory() || before.isSymbolicLink()) throw invalidDirectory();
	const handle = await open(request.path, readOnlyNoFollowFlags());
	try {
		const opened = await handle.stat();
		assertSameDirectory(before, opened);
		if (request.identity && !sameIdentity(opened, request.identity)) throw invalidDirectory();
		assertSameDirectory(opened, await lstat(request.path));
		return new HeldDirectoryLease(request.path, handle, opened);
	} catch (error) {
		await handle.close().catch(() => undefined);
		throw error;
	}
}

/**
 * Remove only the pathname still naming the leased output identity. Node has no
 * portable unlink-by-handle API, so the handle must be closed before deletion
 * on Windows. Observable replacement fails closed; a final close-to-rm OS race
 * remains and is not represented as stronger openat/unlinkat authority.
 */
export async function removeNativeMediaLeasedFile(lease: NativeMediaFileLease): Promise<void> {
	try {
		await lease.revalidate();
		await lease.close();
		await assertFilePathIdentity(lease.path, lease.authenticated.identity);
		await rm(lease.path, { force: false });
	} catch (error) {
		await lease.close().catch(() => undefined);
		throw error;
	}
}

/** See removeNativeMediaLeasedFile for the portable close-to-rm limitation. */
export async function removeNativeMediaLeasedDirectory(
	lease: NativeMediaDirectoryLease,
): Promise<void> {
	try {
		await lease.revalidate();
		await lease.close();
		await assertDirectoryPathIdentity(lease.path, lease.identity);
		await rm(lease.path, { recursive: true, force: false });
	} catch (error) {
		await lease.close().catch(() => undefined);
		throw error;
	}
}

class HeldFileLease implements NativeMediaFileLease {
	readonly path: string;
	readonly authenticated: Readonly<NativeMediaAuthenticatedFile>;
	readonly #handle: FileHandle;
	readonly #opened: Stats;
	#closed = false;

	constructor(path: string, handle: FileHandle, opened: Stats, sha256: string) {
		this.path = path;
		this.#handle = handle;
		this.#opened = opened;
		this.authenticated = Object.freeze({
			byteLength: opened.size,
			sha256,
			identity: identityOf(opened),
		});
	}

	async revalidate(): Promise<void> {
		if (this.#closed) throw new Error('A closed native media file lease cannot be revalidated.');
		const opened = await this.#handle.stat();
		assertStableFile(this.#opened, opened);
		if (await digestStableHandle(this.#handle, opened) !== this.authenticated.sha256) {
			throw invalidFile();
		}
		assertSameFile(opened, await lstat(this.path));
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await this.#handle.close();
	}
}

class HeldDirectoryLease implements NativeMediaDirectoryLease {
	readonly path: string;
	readonly identity: Readonly<NativeMediaFileIdentity>;
	readonly #handle: FileHandle;
	#closed = false;

	constructor(path: string, handle: FileHandle, opened: Stats) {
		this.path = path;
		this.#handle = handle;
		this.identity = identityOf(opened);
	}

	async revalidate(): Promise<void> {
		if (this.#closed) throw new Error('A closed native media directory lease cannot be revalidated.');
		const opened = await this.#handle.stat();
		if (!opened.isDirectory() || !sameIdentity(opened, this.identity)) throw invalidDirectory();
		assertSameDirectory(opened, await lstat(this.path));
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		await this.#handle.close();
	}
}

async function digestStableHandle(handle: FileHandle, expected: Stats): Promise<string> {
	const before = await handle.stat();
	assertStableFile(expected, before);
	const hash = createHash('sha256');
	const buffer = Buffer.allocUnsafe(16 * 1024 * 1024);
	let offset = 0;
	for (;;) {
		const read = await handle.read(buffer, 0, buffer.byteLength, offset);
		if (read.bytesRead === 0) break;
		hash.update(buffer.subarray(0, read.bytesRead));
		offset += read.bytesRead;
	}
	const after = await handle.stat();
	assertStableFile(before, after);
	if (offset !== after.size) throw invalidFile();
	return hash.digest('hex');
}

async function assertFilePathIdentity(path: string, identity: NativeMediaFileIdentity): Promise<void> {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink() || !sameIdentity(details, identity)) throw invalidFile();
}

async function assertDirectoryPathIdentity(path: string, identity: NativeMediaFileIdentity): Promise<void> {
	const details = await lstat(path);
	if (!details.isDirectory() || details.isSymbolicLink() || !sameIdentity(details, identity)) {
		throw invalidDirectory();
	}
}

function assertRequestedFile(details: Stats, request: NativeMediaFileAuthentication): void {
	if (request.byteLength !== undefined && details.size !== request.byteLength) throw invalidFile();
	if (request.maximumBytes !== undefined && details.size > request.maximumBytes) throw invalidFile();
	if (request.identity && !sameIdentity(details, request.identity)) throw invalidFile();
}

function assertFileBound(request: NativeMediaFileAuthentication): void {
	if (request.byteLength === undefined && request.maximumBytes === undefined) throw invalidFile();
}

function assertStableFile(left: Stats, right: Stats): void {
	assertSameFile(left, right);
	if (left.size !== right.size || left.mtimeMs !== right.mtimeMs || left.ctimeMs !== right.ctimeMs) {
		throw invalidFile();
	}
}

function assertSameFile(left: Stats, right: Stats): void {
	if (!right.isFile() || right.isSymbolicLink() || !sameIdentity(left, right)) throw invalidFile();
}

function assertSameDirectory(left: Stats, right: Stats): void {
	if (!right.isDirectory() || right.isSymbolicLink() || !sameIdentity(left, right)) throw invalidDirectory();
}

function sameIdentity(left: Stats, right: NativeMediaFileIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function identityOf(details: Stats): Readonly<NativeMediaFileIdentity> {
	return Object.freeze({ dev: details.dev, ino: details.ino });
}

function readOnlyNoFollowFlags(): number {
	return constants.O_RDONLY | (process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0));
}

function invalidFile(): Error {
	return new Error('A native media file no longer matches its authenticated identity, length, or digest.');
}

function invalidDirectory(): Error {
	return new Error('A native media directory no longer matches its granted identity.');
}
