/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

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
	absoluteManagedMediaRoot,
	assertManagedMediaDescendant,
	assertRealMediaDirectory,
	createRealMediaDirectory,
	DesktopLibraryMediaBodyIntegrityError,
	isMissingFileError,
	mediaPathExists,
	openRegularMediaBody,
	readMediaBodyExactly,
	syncMediaDirectory,
	verifyDesktopLibraryMediaBodyPath,
	writeDeclaredMediaBody,
} from './project-library-media-body.ts';
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
		this.#root = absoluteManagedMediaRoot(options.managedMediaRoot);
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
		const handle = await openRegularMediaBody(path);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size !== descriptor.byteLength) {
				throw new Error('Desktop library managed-media body does not match its declared byte length');
			}
			const result = new Uint8Array(length);
			await readMediaBodyExactly(handle, result, offset, options.signal);
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
		if (await mediaPathExists(finalPath)) await this.#verifyBody(descriptor, signal);
		const stageId = this.#randomId();
		if (!STAGE_ID.test(stageId)) throw new TypeError('Desktop library managed-media stage id is invalid');
		const stagePath = join(directory, `.${descriptor.id}.${stageId}.stage`);
		let handle: FileHandle | null = null;
		let stageExists = false;
		try {
			handle = await open(stagePath, 'wx', 0o600);
			stageExists = true;
			await writeDeclaredMediaBody(handle, chunks, descriptor, this.#maximumChunkBytes, signal);
			await handle.sync();
			await handle.close();
			handle = null;
			throwIfAborted(signal);
			if (await mediaPathExists(finalPath)) {
				await this.#verifyBody(descriptor, signal);
				await unlink(stagePath);
				stageExists = false;
				await syncMediaDirectory(directory);
				return;
			}
			await rename(stagePath, finalPath);
			stageExists = false;
			await syncMediaDirectory(directory);
		} catch (error) {
			const cleanupFailures: unknown[] = [];
			if (handle) {
				try { await handle.close(); } catch (closeError) { cleanupFailures.push(closeError); }
			}
			if (stageExists) {
				try {
					await unlink(stagePath);
					await syncMediaDirectory(directory);
				} catch (cleanupError) {
					if (!isMissingFileError(cleanupError)) cleanupFailures.push(cleanupError);
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
		await verifyDesktopLibraryMediaBodyPath(path, descriptor, this.#maximumChunkBytes, signal);
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
			syncDirectory: () => syncMediaDirectory(directory),
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
			if (isMissingFileError(error) || error instanceof DesktopLibraryMediaBodyIntegrityError) return false;
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
		await assertRealMediaDirectory(this.#root);
		await createRealMediaDirectory(join(this.#root, category));
		await createRealMediaDirectory(directory);
	}

	async #assertScope(directory: string, category: 'audio' | 'video'): Promise<void> {
		for (const candidate of [this.#root, join(this.#root, category), directory]) {
			await assertRealMediaDirectory(candidate);
		}
	}

	#pathFor(relativeFile: string): string {
		const path = resolve(this.#root, ...relativeFile.split('/'));
		assertManagedMediaDescendant(this.#root, path);
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

function throwIfAborted(signal: AbortSignal | undefined): void {
	signal?.throwIfAborted();
}
