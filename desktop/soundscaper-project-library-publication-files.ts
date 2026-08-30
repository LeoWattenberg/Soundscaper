/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants as fileConstants, type Stats } from 'node:fs';
import {
	copyFile,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	unlink,
	type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { SoundscaperDesktopProjectLibraryPaths } from './soundscaper-project-library-contract.ts';
import {
	MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES,
} from './soundscaper-project-library-transfer-contract.ts';
import type {
	SoundscaperDesktopProjectLibraryPublicationPlan,
} from './soundscaper-project-library-publication-contract.ts';

export interface SoundscaperDesktopProjectLibraryPublicationStage {
	readonly role: 'project' | 'body';
	readonly bodyId: string | null;
	readonly stageRelativeFile: string;
	readonly finalRelativeFile: string;
	readonly byteLength: number;
	readonly sha256: string;
}

const READ_CHUNK_BYTES = 1024 * 1024;
const MAXIMUM_VERIFIED_RANGE_FILES = 256;

export interface SoundscaperDesktopProjectLibraryFileSnapshot {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export type SoundscaperDesktopProjectLibraryFileVerifier = (
	path: string,
	byteLength: number,
	sha256: string,
	signal?: AbortSignal,
) => Promise<Readonly<SoundscaperDesktopProjectLibraryFileSnapshot>>;

/** Reuses a bounded authenticated snapshot while checking file identity for every range. */
export class SoundscaperDesktopProjectLibraryFileRangeReader {
	readonly #snapshots = new Map<string, Readonly<SoundscaperDesktopProjectLibraryFileSnapshot>>();
	readonly #verify: SoundscaperDesktopProjectLibraryFileVerifier;

	constructor(verify: SoundscaperDesktopProjectLibraryFileVerifier = verifySoundscaperDesktopProjectLibraryFile) {
		this.#verify = verify;
	}

	async read(
		libraryRoot: string,
		relativeFile: string,
		byteLength: number,
		sha256: string,
		offset: number,
		length: number,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		const path = scopedPath(libraryRoot, relativeFile);
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1
			|| offset >= byteLength || length > byteLength - offset) {
			throw new RangeError('Soundscaper desktop baseline body read leaves its immutable file range');
		}
		throwIfAborted(signal);
		const entry = await lstat(path);
		let snapshot = this.#snapshots.get(path);
		if (!snapshot || snapshot.byteLength !== byteLength || snapshot.sha256 !== sha256
			|| !sameFileSnapshot(snapshot, entry)) {
			snapshot = await this.#verify(path, byteLength, sha256, signal);
			this.#remember(path, snapshot);
		} else {
			this.#snapshots.delete(path);
			this.#snapshots.set(path, snapshot);
		}
		const handle = await openRegular(path);
		try {
			const opened = await handle.stat();
			if (!sameFileSnapshot(snapshot, opened)) {
				this.#snapshots.delete(path);
				throw new Error('Soundscaper desktop baseline immutable file identity changed before bounded read');
			}
			const bytes = new Uint8Array(length);
			let written = 0;
			while (written < bytes.byteLength) {
				throwIfAborted(signal);
				const result = await handle.read(bytes, written, bytes.byteLength - written, offset + written);
				if (result.bytesRead <= 0) throw new Error('Soundscaper desktop baseline body ended during bounded read');
				written += result.bytesRead;
			}
			if (!sameFileSnapshot(snapshot, await handle.stat())) {
				this.#snapshots.delete(path);
				throw new Error('Soundscaper desktop baseline immutable file identity changed during bounded read');
			}
			return bytes;
		} finally {
			await handle.close();
		}
	}

	#remember(path: string, snapshot: Readonly<SoundscaperDesktopProjectLibraryFileSnapshot>): void {
		this.#snapshots.delete(path);
		this.#snapshots.set(path, snapshot);
		while (this.#snapshots.size > MAXIMUM_VERIFIED_RANGE_FILES) {
			const oldest = this.#snapshots.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.#snapshots.delete(oldest);
		}
	}
}

export async function stageSoundscaperDesktopProjectLibraryPublication(
	paths: Readonly<SoundscaperDesktopProjectLibraryPaths>,
	transactionId: string,
	plan: Readonly<SoundscaperDesktopProjectLibraryPublicationPlan>,
	signal?: AbortSignal,
): Promise<readonly Readonly<SoundscaperDesktopProjectLibraryPublicationStage>[]> {
	throwIfAborted(signal);
	await ensureScopedRoots(paths);
	const stages: SoundscaperDesktopProjectLibraryPublicationStage[] = [];
	try {
		const projectBytes = new TextEncoder().encode(plan.document);
		const projectStage = stageDescriptor(
			transactionId,
			0,
			'project',
			null,
			`projects/${plan.projectRelativeFile}`,
			projectBytes.byteLength,
			plan.bundle.project.sha256,
		);
		stages.push(projectStage);
		await writeStaticStage(paths.libraryRoot, projectStage, projectBytes, signal);
		for (const [index, body] of plan.bodies.entries()) {
			throwIfAborted(signal);
			const stage = stageDescriptor(
				transactionId,
				index + 1,
				'body',
				body.bodyId,
				`media/${body.mediaRelativeFile}`,
				body.descriptor.byteLength,
				body.descriptor.sha256,
			);
			stages.push(stage);
			await writeStreamStage(paths.libraryRoot, stage, body.chunks, signal);
		}
		return Object.freeze(stages.map((stage) => Object.freeze(stage)));
	} catch (error) {
		await cleanupSoundscaperDesktopProjectLibraryStages(paths.libraryRoot, stages);
		throw error;
	}
}

export async function materializeSoundscaperDesktopProjectLibraryPublication(
	libraryRoot: string,
	stages: readonly Readonly<SoundscaperDesktopProjectLibraryPublicationStage>[],
	signal?: AbortSignal,
): Promise<void> {
	for (const stage of stages) {
		throwIfAborted(signal);
		const stagePath = scopedPath(libraryRoot, stage.stageRelativeFile);
		const finalPath = scopedPath(libraryRoot, stage.finalRelativeFile);
		await ensureRealDirectory(dirname(finalPath));
		if (await fileExists(finalPath)) {
			await verifySoundscaperDesktopProjectLibraryFile(
				finalPath,
				stage.byteLength,
				stage.sha256,
				signal,
			);
			await unlinkIfPresent(stagePath);
			continue;
		}
		if (!await fileExists(stagePath)) {
			throw new Error(`Soundscaper desktop baseline publication stage is missing: ${stage.stageRelativeFile}`);
		}
		try {
			await link(stagePath, finalPath);
		} catch (error) {
			if (errorCode(error) === 'EXDEV') {
				await copyFile(stagePath, finalPath, fileConstants.COPYFILE_EXCL);
			} else if (errorCode(error) !== 'EEXIST') throw error;
		}
		await verifySoundscaperDesktopProjectLibraryFile(
			finalPath,
			stage.byteLength,
			stage.sha256,
			signal,
		);
		await unlinkIfPresent(stagePath);
	}
}

export async function cleanupSoundscaperDesktopProjectLibraryStages(
	libraryRoot: string,
	stages: readonly Readonly<SoundscaperDesktopProjectLibraryPublicationStage>[],
): Promise<void> {
	const failures: unknown[] = [];
	for (const stage of stages) {
		try { await unlinkIfPresent(scopedPath(libraryRoot, stage.stageRelativeFile)); }
		catch (error) { failures.push(error); }
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Soundscaper desktop baseline stage cleanup failed');
}

export async function readSoundscaperDesktopProjectLibraryFile(
	libraryRoot: string,
	relativeFile: string,
	byteLength: number,
	sha256: string,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const path = scopedPath(libraryRoot, relativeFile);
	await verifySoundscaperDesktopProjectLibraryFile(path, byteLength, sha256, signal);
	throwIfAborted(signal);
	return new Uint8Array(await readFile(path));
}

export async function readSoundscaperDesktopProjectLibraryFileRange(
	libraryRoot: string,
	relativeFile: string,
	byteLength: number,
	sha256: string,
	offset: number,
	length: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	return new SoundscaperDesktopProjectLibraryFileRangeReader().read(
		libraryRoot, relativeFile, byteLength, sha256, offset, length, signal,
	);
}

export async function verifySoundscaperDesktopProjectLibraryFile(
	path: string,
	byteLength: number,
	sha256: string,
	signal?: AbortSignal,
): Promise<Readonly<SoundscaperDesktopProjectLibraryFileSnapshot>> {
	const handle = await openRegular(path);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size !== byteLength) {
			throw new Error('Soundscaper desktop baseline immutable file byte length changed');
		}
		const hash = createHash('sha256');
		const bytes = new Uint8Array(Math.min(READ_CHUNK_BYTES, Math.max(1, byteLength)));
		let offset = 0;
		while (offset < byteLength) {
			throwIfAborted(signal);
			const view = bytes.subarray(0, Math.min(bytes.byteLength, byteLength - offset));
			const result = await handle.read(view, 0, view.byteLength, offset);
			if (result.bytesRead !== view.byteLength) {
				throw new Error('Soundscaper desktop baseline immutable file ended during verification');
			}
			hash.update(view);
			offset += view.byteLength;
		}
		const after = await handle.stat();
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
			|| hash.digest('hex') !== sha256) {
			throw new Error('Soundscaper desktop baseline immutable file failed SHA-256 snapshot verification');
		}
		return fileSnapshot(after, byteLength, sha256);
	} finally {
		await handle.close();
	}
}

function fileSnapshot(
	stat: Stats,
	byteLength: number,
	sha256: string,
): Readonly<SoundscaperDesktopProjectLibraryFileSnapshot> {
	return Object.freeze({
		dev: stat.dev,
		ino: stat.ino,
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		ctimeMs: stat.ctimeMs,
		byteLength,
		sha256,
	});
}

function sameFileSnapshot(
	snapshot: Readonly<SoundscaperDesktopProjectLibraryFileSnapshot>,
	stat: Stats,
): boolean {
	return snapshot.dev === stat.dev && snapshot.ino === stat.ino && snapshot.size === stat.size
		&& snapshot.mtimeMs === stat.mtimeMs && snapshot.ctimeMs === stat.ctimeMs;
}

function stageDescriptor(
	transactionId: string,
	index: number,
	role: 'project' | 'body',
	bodyId: string | null,
	finalRelativeFile: string,
	byteLength: number,
	sha256: string,
): SoundscaperDesktopProjectLibraryPublicationStage {
	return {
		role,
		bodyId,
		stageRelativeFile: `stage/${transactionId}-${String(index).padStart(4, '0')}.stage`,
		finalRelativeFile,
		byteLength,
		sha256,
	};
}

async function writeStaticStage(
	libraryRoot: string,
	stage: SoundscaperDesktopProjectLibraryPublicationStage,
	bytes: Uint8Array,
	signal?: AbortSignal,
): Promise<void> {
	const handle = await createStageHandle(libraryRoot, stage.stageRelativeFile);
	try {
		throwIfAborted(signal);
		await writeExactly(handle, bytes, 0, signal);
		await handle.sync();
	} finally { await handle.close(); }
	await verifySoundscaperDesktopProjectLibraryFile(
		scopedPath(libraryRoot, stage.stageRelativeFile), stage.byteLength, stage.sha256, signal,
	);
}

async function writeStreamStage(
	libraryRoot: string,
	stage: SoundscaperDesktopProjectLibraryPublicationStage,
	chunks: AsyncIterable<Uint8Array>,
	signal?: AbortSignal,
): Promise<void> {
	const handle = await createStageHandle(libraryRoot, stage.stageRelativeFile);
	const hash = createHash('sha256');
	let offset = 0;
	try {
		for await (const value of chunks) {
			throwIfAborted(signal);
			if (!(value instanceof Uint8Array) || value.byteLength < 1
				|| value.byteLength > MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES) {
				throw new RangeError('Soundscaper desktop baseline publication chunk is invalid');
			}
			if (value.byteLength > stage.byteLength - offset) {
				throw new RangeError('Soundscaper desktop baseline publication body exceeds its declared byte length');
			}
			const bytes = Uint8Array.from(value);
			await writeExactly(handle, bytes, offset, signal);
			hash.update(bytes);
			offset += bytes.byteLength;
		}
		if (offset !== stage.byteLength || hash.digest('hex') !== stage.sha256) {
			throw new Error('Soundscaper desktop baseline publication body failed declared SHA-256 integrity');
		}
		await handle.sync();
	} finally { await handle.close(); }
}

async function ensureScopedRoots(paths: Readonly<SoundscaperDesktopProjectLibraryPaths>): Promise<void> {
	await ensureRealDirectory(paths.libraryRoot);
	await ensureRealDirectory(paths.projectsRoot);
	await ensureRealDirectory(paths.managedMediaRoot);
	await ensureRealDirectory(resolve(paths.libraryRoot, 'stage'));
}

async function ensureRealDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new TypeError('Soundscaper desktop baseline publication scope contains a non-directory');
	}
}

async function createStageHandle(libraryRoot: string, relativeFile: string): Promise<FileHandle> {
	const path = scopedPath(libraryRoot, relativeFile);
	await ensureRealDirectory(dirname(path));
	return open(path, fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_WRONLY
		| (process.platform === 'win32' ? 0 : fileConstants.O_NOFOLLOW), 0o600);
}

async function openRegular(path: string): Promise<FileHandle> {
	const entry = await lstat(path);
	if (!entry.isFile() || entry.isSymbolicLink()) {
		throw new TypeError('Soundscaper desktop baseline publication body is not a regular file');
	}
	return open(path, fileConstants.O_RDONLY
		| (process.platform === 'win32' ? 0 : fileConstants.O_NOFOLLOW));
}

async function writeExactly(
	handle: FileHandle,
	bytes: Uint8Array,
	position: number,
	signal?: AbortSignal,
): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		throwIfAborted(signal);
		const result = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
		if (result.bytesWritten <= 0) throw new Error('Soundscaper desktop baseline stage write made no progress');
		offset += result.bytesWritten;
	}
}

function scopedPath(root: string, relativeFile: string): string {
	if (typeof relativeFile !== 'string' || !relativeFile || relativeFile.includes('\0')
		|| isAbsolute(relativeFile) || relativeFile.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw new TypeError('Soundscaper desktop baseline publication relative path is invalid');
	}
	const candidate = resolve(root, ...relativeFile.split('/'));
	const child = relative(resolve(root), candidate);
	if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new TypeError('Soundscaper desktop baseline publication path leaves its library root');
	}
	return candidate;
}

async function fileExists(path: string): Promise<boolean> {
	try { await lstat(path); return true; }
	catch (error) { if (errorCode(error) === 'ENOENT') return false; throw error; }
}

async function unlinkIfPresent(path: string): Promise<void> {
	try { await unlink(path); }
	catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
}

function errorCode(error: unknown): string | null {
	return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
		? error.code
		: null;
}

function throwIfAborted(signal?: AbortSignal): void {
	signal?.throwIfAborted();
}
