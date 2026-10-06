/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resumable, non-overwriting relocation of legacy desktop storage. */

import { createHash } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import {
	chmod, copyFile, lstat, mkdir, open, readdir, rename, rmdir, unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface StorageEntry {
	readonly source: string;
	readonly destination: string;
}

interface MigrationOperations {
	readonly rename: typeof rename;
	readonly copyFile: typeof copyFile;
	readonly unlink: typeof unlink;
}

const OPERATIONS: MigrationOperations = Object.freeze({ rename, copyFile, unlink });

/**
 * Preflight all entries, then move them without replacing destination files.
 * Failed copies remain available for inspection; only verified source duplicates
 * and emptied source directories are removed. A later invocation resumes safely.
 */
export async function migrateDesktopStorageEntries(
	entries: readonly StorageEntry[],
	operations: Partial<MigrationOperations> = {},
): Promise<void> {
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
			await assertSafeAncestors(normalized.source);
			if (await optionalStat(normalized.source) === null) continue;
			await assertSafeAncestors(normalized.destination);
			await preflight(normalized.source, normalized.destination);
			pending.push(normalized);
		} catch (error) {
			throw migrationFailure(normalized, error);
		}
	}
	const io = { ...OPERATIONS, ...operations };
	for (const entry of pending) {
		try { await migrate(entry.source, entry.destination, io); }
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

async function optionalStat(path: string): Promise<Stats | null> {
	try { return await lstat(path); }
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

async function assertSafeAncestors(path: string): Promise<void> {
	const parents: string[] = [];
	for (let parent = dirname(path); ; parent = dirname(parent)) {
		parents.push(parent);
		if (dirname(parent) === parent) break;
	}
	for (const parent of parents.reverse()) {
		const metadata = await optionalStat(parent);
		if (metadata === null) break;
		assertRegularEntry(parent, metadata);
		if (!metadata.isDirectory()) throw new Error(`A path ancestor is not a directory: "${parent}".`);
	}
}

async function preflight(source: string, destination: string): Promise<void> {
	const sourceMetadata = await lstat(source);
	assertRegularEntry(source, sourceMetadata);
	const destinationMetadata = await optionalStat(destination);
	if (destinationMetadata !== null) {
		assertRegularEntry(destination, destinationMetadata);
		if (sourceMetadata.isDirectory() !== destinationMetadata.isDirectory()) {
			throw new Error(`File/directory conflict between "${source}" and "${destination}".`);
		}
	}
	if (sourceMetadata.isDirectory()) {
		for (const child of await readdir(source)) {
			await preflight(join(source, child), join(destination, child));
		}
	} else if (destinationMetadata !== null) {
		await verifyIdentical(source, destination);
	}
}

async function migrate(source: string, destination: string, io: MigrationOperations): Promise<void> {
	const sourceMetadata = await lstat(source);
	assertRegularEntry(source, sourceMetadata);
	let destinationMetadata = await optionalStat(destination);
	if (destinationMetadata !== null) {
		assertRegularEntry(destination, destinationMetadata);
		if (sourceMetadata.isDirectory() !== destinationMetadata.isDirectory()) {
			throw new Error(`File/directory conflict between "${source}" and "${destination}".`);
		}
	}
	await assertSafeAncestors(destination);
	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	if (sourceMetadata.isDirectory()) {
		if (destinationMetadata === null) {
			try { await io.rename(source, destination); return; }
			catch (error) {
				if (!['EXDEV', 'EEXIST', 'ENOTEMPTY'].includes(errorCode(error))) throw error;
			}
			try { await mkdir(destination, { mode: 0o700 }); }
			catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
			destinationMetadata = await lstat(destination);
			assertRegularEntry(destination, destinationMetadata);
			if (!destinationMetadata.isDirectory()) throw new Error(`Directory conflict at "${destination}".`);
		}
		for (const child of await readdir(source)) {
			await migrate(join(source, child), join(destination, child), io);
		}
		await rmdir(source);
		return;
	}
	if (destinationMetadata === null) {
		try {
			await io.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
			await chmod(destination, sourceMetadata.mode & 0o777);
		} catch (error) {
			if (errorCode(error) !== 'EEXIST') throw error;
		}
	}
	const verifiedSource = await verifyIdentical(source, destination);
	if (!sameSnapshot(verifiedSource, await lstat(source))) {
		throw new Error(`The source changed during migration verification: "${source}".`);
	}
	await io.unlink(source);
}

function sameSnapshot(first: Stats, second: Stats): boolean {
	return second.isFile() && first.dev === second.dev && first.ino === second.ino
		&& first.size === second.size && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}

async function fingerprint(path: string): Promise<{ metadata: Stats; sha256: string }> {
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error(`Verification requires a regular file: "${path}".`);
		const digest = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1_048_576);
		let position = 0;
		while (position < metadata.size) {
			const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, metadata.size - position), position);
			if (bytesRead === 0) throw new Error(`The file changed during verification: "${path}".`);
			digest.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		if (!sameSnapshot(metadata, await handle.stat()) || !sameSnapshot(metadata, await lstat(path))) {
			throw new Error(`The file changed during verification: "${path}".`);
		}
		return { metadata, sha256: digest.digest('hex') };
	} finally { await handle.close(); }
}

async function verifyIdentical(source: string, destination: string): Promise<Stats> {
	const sourceMetadata = await lstat(source);
	const destinationMetadata = await lstat(destination);
	assertRegularEntry(source, sourceMetadata);
	assertRegularEntry(destination, destinationMetadata);
	if (!sourceMetadata.isFile() || !destinationMetadata.isFile()
		|| sourceMetadata.size !== destinationMetadata.size) {
		throw new Error(`Verification conflict between "${source}" and "${destination}": files differ.`);
	}
	const original = await fingerprint(source);
	const copied = await fingerprint(destination);
	if (original.metadata.size !== copied.metadata.size || original.sha256 !== copied.sha256) {
		throw new Error(`Verification conflict between "${source}" and "${destination}": files differ.`);
	}
	return original.metadata;
}
