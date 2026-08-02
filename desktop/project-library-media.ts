/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import {
	type DesktopLibraryMedia,
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
} from './project-library-contract.ts';
import {
	DesktopLibraryMediaCapacity,
	type DesktopLibraryMediaStatfs,
} from './project-library-media-capacity.ts';
import {
	createDesktopLibraryMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	isDesktopLibraryManagedMediaBindingId,
	managedMediaCategoryForBinding,
	relativeFileForManagedMediaBinding,
	validatedManagedMediaBindingId,
	type DesktopLibraryManagedMediaEncoding,
	type DesktopLibraryMediaBinding,
} from './project-library-media-binding.ts';
import {
	DesktopLibraryMediaReuseUnavailableError,
	reuseDesktopLibraryMediaBody,
} from './project-library-media-reuse.ts';

export {
	createDesktopLibraryAudioMediaBinding,
	createDesktopLibraryVideoMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
} from './project-library-media-binding.ts';
export type {
	DesktopLibraryManagedMediaEncoding,
	DesktopLibraryMediaBinding,
} from './project-library-media-binding.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const STAGE_ID = /^[a-f0-9]{32}$/u;
const MAXIMUM_BODY_BYTES = 64 * 1024 * 1024 * 1024;
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;

class DesktopLibraryMediaBodyIntegrityError extends Error {}

export interface DesktopLibraryMediaCatalogPort {
	readMetadata(): DesktopLibraryMetadata | Promise<DesktopLibraryMetadata>;
	publishMetadata(
		metadata: DesktopLibraryMetadata,
		signal?: AbortSignal,
	): Promise<DesktopLibraryMetadata>;
}

export interface DesktopLibraryManagedMediaStoreOptions {
	readonly managedMediaRoot: string;
	readonly catalog: DesktopLibraryMediaCatalogPort;
	readonly maximumBodyBytes?: number;
	readonly maximumChunkBytes?: number;
	readonly maximumReadBytes?: number;
	readonly maximumAdmittedBytes?: number;
	readonly maximumMediaRows?: number;
	readonly maximumMetadataBytes?: number;
	readonly hardLink?: (existingPath: string, newPath: string) => Promise<void>;
	readonly randomId?: () => string;
	readonly statfsImpl?: DesktopLibraryMediaStatfs;
}

export interface DesktopLibraryPublishMediaOptions {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly storageKey: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly chunks: AsyncIterable<Uint8Array>;
	readonly encoding: DesktopLibraryManagedMediaEncoding;
	/** Main-owned admission only; renderer uploads never select reusable catalog bodies. */
	readonly reuseExistingBody?: boolean;
	readonly signal?: AbortSignal;
}

export type DesktopLibraryPublishAudioOptions = Omit<DesktopLibraryPublishMediaOptions, 'encoding'>;

export interface DesktopLibraryManagedMediaReadOptions {
	readonly offset: number;
	readonly length: number;
	readonly signal?: AbortSignal;
}

export class DesktopLibraryManagedMediaStore {
	readonly #root: string;
	readonly #catalog: DesktopLibraryMediaCatalogPort;
	readonly #capacity: DesktopLibraryMediaCapacity;
	readonly #maximumBodyBytes: number;
	readonly #maximumChunkBytes: number;
	readonly #maximumReadBytes: number;
	readonly #hardLink: ((existingPath: string, newPath: string) => Promise<void>) | undefined;
	readonly #randomId: () => string;
	readonly #bindingTails = new Map<string, Promise<void>>();
	#catalogTail: Promise<void> = Promise.resolve();

	constructor(options: DesktopLibraryManagedMediaStoreOptions) {
		this.#root = absoluteRoot(options.managedMediaRoot);
		this.#capacity = new DesktopLibraryMediaCapacity({
			managedMediaRoot: this.#root,
			maximumAdmittedBytes: options.maximumAdmittedBytes,
			maximumMediaRows: options.maximumMediaRows,
			maximumMetadataBytes: options.maximumMetadataBytes,
			statfsImpl: options.statfsImpl,
		});
		if (!options.catalog || typeof options.catalog.readMetadata !== 'function'
			|| typeof options.catalog.publishMetadata !== 'function') {
			throw new TypeError('Desktop library managed-media store requires a catalog port');
		}
		this.#catalog = options.catalog;
		this.#maximumBodyBytes = boundedLimit(
			options.maximumBodyBytes,
			MAXIMUM_BODY_BYTES,
			'managed-media body byte limit',
		);
		this.#maximumChunkBytes = boundedLimit(
			options.maximumChunkBytes,
			MAXIMUM_CHUNK_BYTES,
			'managed-media chunk byte limit',
		);
		this.#maximumReadBytes = boundedLimit(
			options.maximumReadBytes,
			this.#maximumChunkBytes,
			'managed-media read byte limit',
		);
		this.#hardLink = options.hardLink;
		this.#randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
	}

	publishAudio(options: DesktopLibraryPublishAudioOptions): Promise<DesktopLibraryMedia> {
		return this.publish({ ...options, encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING });
	}

	publish(options: DesktopLibraryPublishMediaOptions): Promise<DesktopLibraryMedia> {
		const binding = createDesktopLibraryMediaBinding(
			options.encoding,
			options.projectId,
			options.storageKey,
			options.projectRevision,
			options.projectSha256,
		);
		return this.#serializeBinding(binding.id, async () => {
			throwIfAborted(options.signal);
			const descriptor = mediaDescriptor(binding, options.byteLength, options.sha256, this.#maximumBodyBytes);
			const initial = await this.#readCatalog();
			const existing = mediaById(initial, descriptor.id);
			if (existing) {
				assertSameDescriptor(existing, descriptor);
				await this.#verifyBody(existing, options.signal);
				return existing;
			}
			const reservation = await this.#capacity.reserve(initial, descriptor, options.signal);
			try {
				if (options.reuseExistingBody) {
					const reused = await this.#reuseBody(reusableMedia(initial, descriptor), descriptor, options.signal);
					if (!reused) throw new DesktopLibraryMediaReuseUnavailableError();
				} else await this.#materializeBody(descriptor, options.chunks, options.signal);
				return await this.#serializeCatalog(() => this.#publishDescriptor(descriptor, options.signal));
			} finally {
				reservation.release();
			}
		});
	}

	async read(bindingId: string, options: DesktopLibraryManagedMediaReadOptions): Promise<Uint8Array> {
		const id = validatedManagedMediaBindingId(bindingId);
		const offset = nonNegativeSafeInteger(options.offset, 'managed-media read offset');
		const length = positiveSafeInteger(options.length, 'managed-media read length');
		if (length > this.#maximumReadBytes) {
			throw new RangeError('Desktop library managed-media read length exceeds its byte limit');
		}
		throwIfAborted(options.signal);
		const metadata = await this.#readCatalog();
		const descriptor = mediaById(metadata, id);
		if (!descriptor) throw new Error('Desktop library managed-media binding is not present in the catalog');
		if (descriptor.relativeFile !== relativeFileForManagedMediaBinding(id)) {
			throw new TypeError('Desktop library managed-media binding has a non-canonical path');
		}
		if (offset > descriptor.byteLength || length > descriptor.byteLength - offset) {
			throw new RangeError('Desktop library managed-media read range exceeds the body');
		}
		const path = this.#pathFor(descriptor.relativeFile);
		await this.#assertScope(dirname(path), managedMediaCategoryForBinding(id));
		const handle = await openRegularBody(path);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size !== descriptor.byteLength) {
				throw new Error('Desktop library managed-media body does not match its declared byte length');
			}
			const result = new Uint8Array(length);
			await readExactly(handle, result, offset, options.signal);
			return result;
		} finally {
			await handle.close();
		}
	}

	async #materializeBody(
		descriptor: DesktopLibraryMedia,
		chunks: AsyncIterable<Uint8Array>,
		signal: AbortSignal | undefined,
	): Promise<void> {
		if (!chunks || typeof chunks[Symbol.asyncIterator] !== 'function') {
			throw new TypeError('Desktop library managed-media body must be an async iterable');
		}
		const finalPath = this.#pathFor(descriptor.relativeFile);
		const directory = dirname(finalPath);
		await this.#prepareDirectory(directory, managedMediaCategoryForBinding(descriptor.id));
		if (await pathExists(finalPath)) await this.#verifyBody(descriptor, signal);
		const stageId = this.#randomId();
		if (!STAGE_ID.test(stageId)) throw new TypeError('Desktop library managed-media stage id is invalid');
		const stagePath = join(directory, `.${descriptor.id}.${stageId}.stage`);
		let handle: FileHandle | null = null;
		let stageExists = false;
		try {
			handle = await open(stagePath, 'wx', 0o600);
			stageExists = true;
			await writeDeclaredBody(handle, chunks, descriptor, this.#maximumChunkBytes, signal);
			await handle.sync();
			await handle.close();
			handle = null;
			throwIfAborted(signal);
			if (await pathExists(finalPath)) {
				await this.#verifyBody(descriptor, signal);
				await unlink(stagePath);
				stageExists = false;
				await syncDirectory(directory);
				return;
			}
			await rename(stagePath, finalPath);
			stageExists = false;
			await syncDirectory(directory);
		} catch (error) {
			const cleanupFailures: unknown[] = [];
			if (handle) {
				try { await handle.close(); } catch (closeError) { cleanupFailures.push(closeError); }
			}
			if (stageExists) {
				try {
					await unlink(stagePath);
					await syncDirectory(directory);
				} catch (cleanupError) {
					if (!isMissing(cleanupError)) cleanupFailures.push(cleanupError);
				}
			}
			if (cleanupFailures.length > 0) {
				throw new AggregateError([error, ...cleanupFailures], 'Managed-media body publication and cleanup failed');
			}
			throw error;
		}
	}

	async #verifyBody(descriptor: DesktopLibraryMedia, signal: AbortSignal | undefined): Promise<void> {
		const path = this.#pathFor(descriptor.relativeFile);
		await this.#assertScope(dirname(path), managedMediaCategoryForBinding(descriptor.id));
		await this.#verifyBodyPath(path, descriptor, signal);
	}

	async #verifyBodyPath(
		path: string,
		descriptor: DesktopLibraryMedia,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const handle = await openRegularBody(path);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size !== descriptor.byteLength) {
				throw new DesktopLibraryMediaBodyIntegrityError('Desktop library managed-media body does not match its immutable descriptor');
			}
			const hash = createHash('sha256');
			const buffer = new Uint8Array(Math.min(this.#maximumChunkBytes, Math.max(1, descriptor.byteLength)));
			let offset = 0;
			while (offset < descriptor.byteLength) {
				throwIfAborted(signal);
				const view = buffer.subarray(0, Math.min(buffer.byteLength, descriptor.byteLength - offset));
				await readExactly(handle, view, offset, signal);
				hash.update(view);
				offset += view.byteLength;
			}
			if (hash.digest('hex') !== descriptor.sha256) {
				throw new DesktopLibraryMediaBodyIntegrityError('Desktop library managed-media body does not match its immutable SHA-256 descriptor');
			}
		} finally {
			await handle.close();
		}
	}

	async #reuseBody(
		sources: readonly DesktopLibraryMedia[],
		descriptor: DesktopLibraryMedia,
		signal: AbortSignal | undefined,
	): Promise<boolean> {
		if (sources.length === 0) return false;
		const category = managedMediaCategoryForBinding(descriptor.id);
		const finalPath = this.#pathFor(descriptor.relativeFile);
		const directory = dirname(finalPath);
		const sourcePaths = sources.map(({ relativeFile }) => this.#pathFor(relativeFile));
		await this.#prepareDirectory(directory, category);
		return reuseDesktopLibraryMediaBody({
			directory, finalPath, hardLink: this.#hardLink, randomId: this.#randomId, signal, sourcePaths,
			syncDirectory: () => syncDirectory(directory),
			verifySourcePath: (path) => this.#verifyReusableSource(path, descriptor, category, signal),
			verifyTargetPath: async (path) => {
				await this.#assertScope(dirname(path), category);
				await this.#verifyBodyPath(path, descriptor, signal);
			},
		});
	}

	async #verifyReusableSource(
		path: string,
		descriptor: DesktopLibraryMedia,
		category: 'audio' | 'video',
		signal: AbortSignal | undefined,
	): Promise<boolean> {
		try {
			await this.#assertScope(dirname(path), category);
			await this.#verifyBodyPath(path, descriptor, signal);
			return true;
		} catch (error) {
			throwIfAborted(signal);
			if (isMissing(error) || error instanceof DesktopLibraryMediaBodyIntegrityError) return false;
			throw error;
		}
	}

	async #publishDescriptor(
		descriptor: DesktopLibraryMedia,
		signal: AbortSignal | undefined,
	): Promise<DesktopLibraryMedia> {
		throwIfAborted(signal);
		const current = await this.#readCatalog();
		const existing = mediaById(current, descriptor.id);
		if (existing) {
			assertSameDescriptor(existing, descriptor);
			return existing;
		}
		const candidate = this.#capacity.candidateForPublication(current, descriptor);
		const admitted = validateDesktopLibraryMetadata(await this.#catalog.publishMetadata(candidate, signal));
		const published = mediaById(admitted, descriptor.id);
		if (!published) throw new Error('Desktop library catalog did not admit the managed-media binding');
		assertSameDescriptor(published, descriptor);
		return published;
	}

	async #prepareDirectory(directory: string, category: 'audio' | 'video'): Promise<void> {
		await mkdir(this.#root, { recursive: true, mode: 0o700 });
		await assertRealDirectory(this.#root);
		await createRealChildDirectory(join(this.#root, category));
		await createRealChildDirectory(directory);
	}

	async #assertScope(directory: string, category: 'audio' | 'video'): Promise<void> {
		for (const candidate of [this.#root, join(this.#root, category), directory]) {
			await assertRealDirectory(candidate);
		}
	}

	#pathFor(relativeFile: string): string {
		const path = resolve(this.#root, ...relativeFile.split('/'));
		assertDescendant(this.#root, path);
		return path;
	}

	async #readCatalog(): Promise<DesktopLibraryMetadata> {
		return validateDesktopLibraryMetadata(await this.#catalog.readMetadata());
	}

	#serializeBinding<Result>(bindingId: string, operation: () => Promise<Result>): Promise<Result> {
		const predecessor = this.#bindingTails.get(bindingId) ?? Promise.resolve();
		const result = predecessor.catch(() => undefined).then(operation);
		const tail = result.then(() => undefined, () => undefined);
		this.#bindingTails.set(bindingId, tail);
		void tail.finally(() => {
			if (this.#bindingTails.get(bindingId) === tail) this.#bindingTails.delete(bindingId);
		});
		return result;
	}

	#serializeCatalog<Result>(operation: () => Promise<Result>): Promise<Result> {
		const result = this.#catalogTail.catch(() => undefined).then(operation);
		this.#catalogTail = result.then(() => undefined, () => undefined);
		return result;
	}
}

async function writeDeclaredBody(
	handle: FileHandle,
	chunks: AsyncIterable<Uint8Array>,
	descriptor: DesktopLibraryMedia,
	maximumChunkBytes: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	const hash = createHash('sha256');
	let byteLength = 0;
	for await (const chunk of chunks) {
		throwIfAborted(signal);
		if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
			throw new TypeError('Desktop library managed-media chunk must be a non-empty Uint8Array');
		}
		if (chunk.byteLength > maximumChunkBytes) {
			throw new RangeError('Desktop library managed-media chunk exceeds its byte limit');
		}
		if (chunk.byteLength > descriptor.byteLength - byteLength) {
			throw new RangeError('Desktop library managed-media body exceeds its declared byte length');
		}
		const ownedChunk = Uint8Array.from(chunk);
		hash.update(ownedChunk);
		await writeExactly(handle, ownedChunk, byteLength, signal);
		byteLength += ownedChunk.byteLength;
	}
	if (byteLength !== descriptor.byteLength) {
		throw new RangeError('Desktop library managed-media body ended before its declared byte length');
	}
	if (hash.digest('hex') !== descriptor.sha256) {
		throw new Error('Desktop library managed-media SHA-256 does not match its declaration');
	}
}

async function writeExactly(
	handle: FileHandle,
	bytes: Uint8Array,
	position: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		throwIfAborted(signal);
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
		if (bytesWritten <= 0) throw new Error('Desktop library managed-media stage write made no progress');
		offset += bytesWritten;
	}
}

async function readExactly(
	handle: FileHandle,
	bytes: Uint8Array,
	position: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		throwIfAborted(signal);
		const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, position + offset);
		if (bytesRead <= 0) {
			throw new DesktopLibraryMediaBodyIntegrityError('Desktop library managed-media body ended during a bounded read');
		}
		offset += bytesRead;
	}
}

function mediaDescriptor(
	binding: DesktopLibraryMediaBinding,
	byteLengthValue: unknown,
	sha256Value: unknown,
	maximumBodyBytes: number,
): DesktopLibraryMedia {
	const byteLength = nonNegativeSafeInteger(byteLengthValue, 'managed-media declared byte length');
	if (byteLength > maximumBodyBytes) {
		throw new RangeError('Desktop library managed-media body exceeds its byte limit');
	}
	if (typeof sha256Value !== 'string' || !DIGEST.test(sha256Value)) {
		throw new TypeError('Desktop library managed-media declaration has an invalid SHA-256 digest');
	}
	return Object.freeze({ ...binding, byteLength, sha256: sha256Value });
}

function mediaById(metadata: DesktopLibraryMetadata, id: string): DesktopLibraryMedia | undefined {
	return metadata.media.find((entry) => entry.id === id);
}

function reusableMedia(
	metadata: DesktopLibraryMetadata,
	descriptor: DesktopLibraryMedia,
): DesktopLibraryMedia[] {
	return metadata.media.filter((entry) => entry.id !== descriptor.id
		&& isDesktopLibraryManagedMediaBindingId(entry.id)
		&& entry.id[0] === descriptor.id[0]
		&& entry.relativeFile === relativeFileForManagedMediaBinding(entry.id)
		&& entry.byteLength === descriptor.byteLength
		&& entry.sha256 === descriptor.sha256);
}

function assertSameDescriptor(actual: DesktopLibraryMedia, expected: DesktopLibraryMedia): void {
	if (actual.id !== expected.id || actual.relativeFile !== expected.relativeFile
		|| actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
		throw new Error('Desktop library immutable managed-media binding conflict');
	}
}

function absoluteRoot(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError('Desktop library managed-media root must be an absolute path without NUL bytes');
	}
	return normalize(value);
}

function assertDescendant(root: string, candidate: string): void {
	const child = relative(resolve(root), resolve(candidate));
	if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new TypeError('Desktop library managed-media path leaves its fixed scope');
	}
}

function boundedLimit(value: unknown, hardMaximum: number, label: string): number {
	if (value === undefined) return hardMaximum;
	const limit = positiveSafeInteger(value, label);
	if (limit > hardMaximum) throw new RangeError(`Desktop library ${label} exceeds its hard maximum`);
	return limit;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Desktop library ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
	const result = nonNegativeSafeInteger(value, label);
	if (result === 0) throw new RangeError(`Desktop library ${label} must be positive`);
	return result;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}

async function createRealChildDirectory(directory: string): Promise<void> {
	try {
		await mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
	}
	await assertRealDirectory(directory);
}

async function assertRealDirectory(directory: string): Promise<void> {
	const stat = await lstat(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new TypeError('Desktop library managed-media scope contains a non-directory component');
	}
}

async function openRegularBody(path: string): Promise<FileHandle> {
	const entry = await lstat(path);
	if (!entry.isFile() || entry.isSymbolicLink()) {
		throw new DesktopLibraryMediaBodyIntegrityError('Desktop library managed-media body is not a regular file');
	}
	const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
	const handle = await open(path, flags);
	try {
		if (!(await handle.stat()).isFile()) {
			throw new DesktopLibraryMediaBodyIntegrityError('Desktop library managed-media body is not a regular file');
		}
		return handle;
	} catch (error) {
		await handle.close();
		throw error;
	}
}

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') return;
	const handle = await open(directory, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function isMissing(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	signal?.throwIfAborted();
}
