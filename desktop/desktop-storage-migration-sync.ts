/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pre-ready relocation of Electron-owned storage without yielding to Chromium. */

import { createHash } from 'node:crypto';
import {
	constants as fsConstants, chmodSync as chmod, closeSync, copyFileSync, fstatSync,
	lstatSync as lstat, mkdirSync as mkdir, openSync, readSync, readdirSync as readdir,
	renameSync, rmdirSync as rmdir, unlinkSync, type Stats,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface StorageEntry {
	readonly source: string;
	readonly destination: string;
}

interface MigrationOperations {
	readonly renameSync: typeof renameSync;
	readonly copyFileSync: typeof copyFileSync;
	readonly unlinkSync: typeof unlinkSync;
	readonly readSync: (descriptor: number, buffer: Uint8Array, offset: number, length: number, position: number) => number;
}

const OPERATIONS: MigrationOperations = Object.freeze({ renameSync, copyFileSync, unlinkSync, readSync });

/**
 * Preflight all entries, then move them without replacing destination files.
 * Failed copies remain available for inspection; only verified source duplicates
 * and emptied source directories are removed. A later invocation resumes safely.
 */
export function migrateDesktopStorageEntriesSync(
	entries: readonly StorageEntry[],
	operations: Partial<MigrationOperations> = {},
): void {
	const io = { ...OPERATIONS, ...operations };
	const pending: StorageEntry[] = [];
	for (const entry of entries) {
		if (!validPath(entry.source) || !validPath(entry.destination)) {
			throw new TypeError('Desktop storage migration requires nonempty filesystem paths.');
		}
		const normalized = { source: resolve(entry.source), destination: resolve(entry.destination) };
		if (normalized.source === normalized.destination) continue;
		try {
			if (nested(normalized.source, normalized.destination)
				|| nested(normalized.destination, normalized.source)) {
				throw new Error('Source and destination paths overlap or are nested.');
			}
			assertSafeAncestors(normalized.source);
			if (optionalStat(normalized.source) === null) continue;
			assertSafeAncestors(normalized.destination);
			preflight(normalized.source, normalized.destination, io);
			pending.push(normalized);
		} catch (error) {
			throw migrationFailure(normalized, error);
		}
	}
	for (const entry of pending) {
		try { migrate(entry.source, entry.destination, io); }
		catch (error) { throw migrationFailure(entry, error); }
	}
}

function validPath(value: string): boolean {
	return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function nested(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

function migrationFailure(entry: StorageEntry, cause: unknown): Error {
	const reason = cause instanceof Error ? cause.message : String(cause);
	return new Error(
		`Could not migrate desktop storage: source "${entry.source}", destination "${entry.destination}": ${reason} `
		+ 'Resolve the conflicting or unsupported paths and restart. Existing destination data is preserved.',
		{ cause },
	);
}

function errorCode(error: unknown): string {
	return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function optionalStat(path: string): Stats | null {
	try { return lstat(path); }
	catch (error) {
		if (errorCode(error) === 'ENOENT') return null;
		throw error;
	}
}

function assertRegularEntry(path: string, metadata: Stats): void {
	if (metadata.isSymbolicLink()) throw new Error(`Symbolic links are unsupported: "${path}".`);
	if (!metadata.isDirectory() && !metadata.isFile()) {
		throw new Error(`Only regular files and directories can migrate: "${path}".`);
	}
}

function assertSafeAncestors(path: string): void {
	const parents: string[] = [];
	for (let parent = dirname(path); ; parent = dirname(parent)) {
		parents.push(parent);
		if (dirname(parent) === parent) break;
	}
	for (const parent of parents.reverse()) {
		const metadata = optionalStat(parent);
		if (metadata === null) break;
		assertRegularEntry(parent, metadata);
		if (!metadata.isDirectory()) throw new Error(`A path ancestor is not a directory: "${parent}".`);
	}
}

function preflight(source: string, destination: string, io: MigrationOperations): void {
	const sourceMetadata = lstat(source);
	assertRegularEntry(source, sourceMetadata);
	const destinationMetadata = optionalStat(destination);
	if (destinationMetadata !== null) {
		assertRegularEntry(destination, destinationMetadata);
		if (sourceMetadata.isDirectory() !== destinationMetadata.isDirectory()) {
			throw new Error(`File/directory conflict between "${source}" and "${destination}".`);
		}
	}
	if (sourceMetadata.isDirectory()) {
		for (const child of readdir(source)) {
			preflight(join(source, child), join(destination, child), io);
		}
	} else if (destinationMetadata !== null) {
		verifyIdentical(source, destination, io);
	}
}

function migrate(source: string, destination: string, io: MigrationOperations): void {
	const sourceMetadata = lstat(source);
	assertRegularEntry(source, sourceMetadata);
	let destinationMetadata = optionalStat(destination);
	if (destinationMetadata !== null) {
		assertRegularEntry(destination, destinationMetadata);
		if (sourceMetadata.isDirectory() !== destinationMetadata.isDirectory()) {
			throw new Error(`File/directory conflict between "${source}" and "${destination}".`);
		}
	}
	assertSafeAncestors(destination);
	mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	if (sourceMetadata.isDirectory()) {
		if (destinationMetadata === null) {
			try { io.renameSync(source, destination); return; }
			catch (error) {
				if (!['EXDEV', 'EEXIST', 'ENOTEMPTY'].includes(errorCode(error))) throw error;
			}
			try { mkdir(destination, { mode: 0o700 }); }
			catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
			destinationMetadata = lstat(destination);
			assertRegularEntry(destination, destinationMetadata);
			if (!destinationMetadata.isDirectory()) throw new Error(`Directory conflict at "${destination}".`);
		}
		for (const child of readdir(source)) {
			migrate(join(source, child), join(destination, child), io);
		}
		rmdir(source);
		return;
	}
	if (destinationMetadata === null) {
		try {
			io.copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
			chmod(destination, sourceMetadata.mode & 0o777);
		} catch (error) {
			if (errorCode(error) !== 'EEXIST') throw error;
		}
	}
	const verifiedSource = verifyIdentical(source, destination, io);
	if (!sameSnapshot(verifiedSource, lstat(source))) {
		throw new Error(`The source changed during migration verification: "${source}".`);
	}
	io.unlinkSync(source);
}

function sameSnapshot(first: Stats, second: Stats): boolean {
	return second.isFile() && first.dev === second.dev && first.ino === second.ino
		&& first.size === second.size && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}

function fingerprint(path: string, io: MigrationOperations): { metadata: Stats; sha256: string } {
	const descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const metadata = fstatSync(descriptor);
		if (!metadata.isFile()) throw new Error(`Verification requires a regular file: "${path}".`);
		const digest = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1_048_576);
		let position = 0;
		while (position < metadata.size) {
			const bytesRead = io.readSync(descriptor, buffer, 0, Math.min(buffer.length, metadata.size - position), position);
			if (bytesRead === 0) throw new Error(`The file changed during verification: "${path}".`);
			digest.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		if (!sameSnapshot(metadata, fstatSync(descriptor)) || !sameSnapshot(metadata, lstat(path))) {
			throw new Error(`The file changed during verification: "${path}".`);
		}
		return { metadata, sha256: digest.digest('hex') };
	} finally { closeSync(descriptor); }
}

function verifyIdentical(source: string, destination: string, io: MigrationOperations): Stats {
	const sourceMetadata = lstat(source);
	const destinationMetadata = lstat(destination);
	assertRegularEntry(source, sourceMetadata);
	assertRegularEntry(destination, destinationMetadata);
	if (!sourceMetadata.isFile() || !destinationMetadata.isFile()
		|| sourceMetadata.size !== destinationMetadata.size) {
		throw new Error(`Verification conflict between "${source}" and "${destination}": files differ.`);
	}
	const original = fingerprint(source, io);
	const copied = fingerprint(destination, io);
	if (original.metadata.size !== copied.metadata.size || original.sha256 !== copied.sha256) {
		throw new Error(`Verification conflict between "${source}" and "${destination}": files differ.`);
	}
	return original.metadata;
}
