/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../../common/editor/abort-error.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { openDatabase } from '../../common/editor/storage/indexeddb-backend.ts';
import { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import type { MediaAssetMaintenance } from '../../common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { MediaRepository } from '../../common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../../common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../../common/editor/storage/opfs-repository.ts';
import type { OpfsSyncStoragePort } from '../../common/editor/storage/opfs-sync-worker-client.ts';
import { RetentionSessionGuard } from '../../common/editor/storage/retention-session-guard.ts';
import { EditorStoreClosedError, EditorStoreVersionStaleError } from '../../common/editor/storage/status.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1, type PhotoPreviewCachePortV1 } from '../preview/photo-preview-cache-v1.ts';

export const PHOTO_MEDIA_NAMESPACES_V1 = Object.freeze({
	databaseName: 'lightscaper-photo-media-v2',
	opfsDirectoryName: 'lightscaper-photo-originals',
	opfsWorkerName: 'lightscaper-photo-opfs',
});

export interface PhotoMediaStoreOptionsV1 {
	readonly indexedDB?: IDBFactory | null;
	readonly locks?: LockManager | null;
	readonly storageManager?: StorageManager | null;
	readonly opfsRoot?: FileSystemDirectoryHandle | null;
	readonly preferOpfs?: boolean;
	readonly syncWorkerClient?: OpfsSyncStoragePort | null;
	readonly databaseName?: string;
	readonly opfsDirectoryName?: string;
	readonly opfsWorkerName?: string;
}

export type PhotoMediaSettingsRepositoryV1 = Readonly<Pick<KeyValueRepository,
	'get' | 'put' | 'delete' | 'putIfAbsent' | 'replaceIfCurrent' | 'deleteIfCurrent'>>;
export type PhotoOriginalMediaRepositoryV1 = Readonly<Pick<MediaRepository,
	'catalogOriginals' | 'beginAssetWrite' | 'writeAsset' | 'loadAsset' | 'getAssetMetadata' | 'deleteAsset'>>;

const OPTIONS = ['indexedDB', 'locks', 'storageManager', 'opfsRoot', 'preferOpfs', 'syncWorkerClient',
	'databaseName', 'opfsDirectoryName', 'opfsWorkerName'];
const ORIGINAL_FIELDS = ['schemaVersion', 'kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256',
	'width', 'height', 'hasAlpha', 'byteLength', 'retention'];
const throwIfAborted = createAbortGuard('Photo original verification was cancelled.');

/** Product-owned durable media composition, independent of every timeline store. */
export class PhotoMediaStoreV1 {
	readonly mediaRepository: PhotoOriginalMediaRepositoryV1;
	readonly settingsRepository: PhotoMediaSettingsRepositoryV1;
	readonly #media: MediaRepository;
	readonly #factory: IDBFactory | null;
	readonly #databaseName: string;
	readonly #opfs: OpfsRepository;
	readonly #guard: RetentionSessionGuard;
	readonly #owned = new Set<Promise<unknown>>();
	#previewCache: PhotoPreviewCachePortV1 | null = null;
	#opening: Promise<IDBDatabase> | null = null;
	#connection: IDBDatabase | null = null;
	#closing: Promise<void> | null = null;
	#closeRequested = false;
	#versionStale = false;

	constructor(options: PhotoMediaStoreOptionsV1 = {}) {
		readClosedDomainRecord(options, 'photo media store options', OPTIONS, []);
		this.#databaseName = namespace(options.databaseName ?? PHOTO_MEDIA_NAMESPACES_V1.databaseName);
		const opfsDirectoryName = namespace(options.opfsDirectoryName ?? PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName);
		const opfsWorkerName = namespace(options.opfsWorkerName ?? PHOTO_MEDIA_NAMESPACES_V1.opfsWorkerName);
		if (options.preferOpfs !== undefined && typeof options.preferOpfs !== 'boolean') {
			throw new TypeError('Photo media OPFS preference must be a boolean.');
		}
		this.#factory = options.indexedDB === undefined ? globalThis.indexedDB ?? null : options.indexedDB;
		if (this.#factory !== null && typeof this.#factory.open !== 'function') {
			throw new TypeError('Photo media storage requires an IndexedDB factory.');
		}
		const port = { memory: getMemoryDatabase(this.#databaseName), database: () => this.#database() };
		this.#guard = new RetentionSessionGuard(port, options.locks === undefined ? globalThis.navigator?.locks ?? null : options.locks);
		this.#opfs = new OpfsRepository({
			preferOpfs: options.preferOpfs ?? true,
			storageManager: options.storageManager === undefined ? globalThis.navigator?.storage ?? null : options.storageManager,
			opfsRoot: options.opfsRoot,
			syncWorkerClient: options.syncWorkerClient,
			opfsDirectoryName, opfsWorkerName,
		});
		const guarded = this.#guard.port();
		const media = new MediaRepository(guarded, this.#opfs, { sessionGuard: this.#guard });
		this.#media = media;
		this.mediaRepository = Object.freeze({
			catalogOriginals: media.catalogOriginals,
			beginAssetWrite: (...args: Parameters<MediaRepository['beginAssetWrite']>) => media.beginAssetWrite(...args),
			writeAsset: (...args: Parameters<MediaRepository['writeAsset']>) => media.writeAsset(...args),
			loadAsset: (...args: Parameters<MediaRepository['loadAsset']>) => media.loadAsset(...args),
			getAssetMetadata: (sourceId: string) => this.#own(() => media.getAssetMetadata(sourceId)),
			deleteAsset: (sourceId: string) => this.#own(() => media.deleteAsset(sourceId)),
		});
		const settings = new KeyValueRepository(guarded, 'settings');
		this.settingsRepository = Object.freeze({
			get: (key: string) => this.#own(() => settings.get(key)),
			put: (key: string, value: unknown) => this.#own(() => settings.put(key, value)),
			delete: (key: string) => this.#own(() => settings.delete(key)),
			putIfAbsent: (key: string, value: unknown) => this.#own(() => settings.putIfAbsent(key, value)),
			replaceIfCurrent: (key: string, expected: unknown, replacement: unknown) =>
				this.#own(() => settings.replaceIfCurrent(key, expected, replacement)),
			deleteIfCurrent: (key: string, expected: unknown) => this.#own(() => settings.deleteIfCurrent(key, expected)),
		});
	}

	ready(): Promise<this> {
		return this.#own(async () => { await this.#guard.database(); return this; });
	}

	getPreviewCache(): PhotoPreviewCachePortV1 {
		this.#assertAccepting();
		if (!this.#previewCache) {
			const cache = new PhotoPreviewCacheV1(this.#media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1));
			this.#previewCache = Object.freeze({
				load: (...args: Parameters<PhotoPreviewCachePortV1['load']>) => this.#own(() => cache.load(...args)),
				store: (...args: Parameters<PhotoPreviewCachePortV1['store']>) => this.#own(() => cache.store(...args)),
				trim: (...args: Parameters<PhotoPreviewCachePortV1['trim']>) => this.#own(() => cache.trim(...args)),
			});
		}
		return this.#previewCache;
	}

	readonly verifyOriginal = (original: PhotoOriginalV1, signal?: AbortSignal): Promise<void> => {
		return this.#own(async () => {
			throwIfAborted(signal);
			const input = readClosedDomainRecord(original, 'photo original', ORIGINAL_FIELDS);
			const storageKey = readClosedDomainField(input, 'storageKey', 'photo original');
			const digest = readClosedDomainField(input, 'contentSha256', 'photo original');
			const size = readClosedDomainField(input, 'byteLength', 'photo original');
			if (typeof storageKey !== 'string' || !storageKey || storageKey.trim() !== storageKey
				|| typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)
				|| typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) {
				throw new TypeError('Photo original verification requires an immutable digest, storage key and byte length.');
			}
			const metadata = await this.mediaRepository.getAssetMetadata(storageKey);
			throwIfAborted(signal);
			if (!metadata || metadata.sourceId !== storageKey || metadata.sha256 !== digest || metadata.size !== size) {
				throw new Error('Photo original media identity does not match its verified durable asset.');
			}
		});
	};

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closeRequested = true;
		const maintenance = this.#media.beginAssetMaintenance({ permanent: true });
		this.#closing = this.#close(maintenance);
		return this.#closing;
	}

	async #close(maintenance: MediaAssetMaintenance): Promise<void> {
		const errors: unknown[] = [];
		try { await maintenance.abortActive(); } catch (error) { errors.push(error); }
		await Promise.allSettled([...this.#owned]);
		// A pending opening owns any late successful handle until this cleanup.
		await this.#opening?.catch(() => undefined);
		try { await this.#guard.release(this.#connection); } catch (error) { errors.push(error); }
		try { this.#opfs.close(); } catch (error) { errors.push(error); }
		try {
			if (this.#connection) {
				this.#connection.onversionchange = null;
				this.#connection.close();
			}
		} catch (error) { errors.push(error); }
		this.#connection = null;
		this.#opening = null;
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'Photo media storage cleanup failed.');
	}

	#own<Result>(operation: () => Promise<Result>): Promise<Result> {
		try { this.#assertAccepting(); } catch (error) { return Promise.reject(error); }
		const pending = Promise.resolve().then(operation);
		this.#owned.add(pending);
		void pending.then(() => { this.#owned.delete(pending); }, () => { this.#owned.delete(pending); });
		return pending;
	}

	async #database(): Promise<IDBDatabase> {
		this.#assertAccepting();
		if (!this.#factory) throw new Error('Photo media storage requires durable IndexedDB.');
		if (!this.#opening) {
			const opening = openDatabase(this.#factory, this.#databaseName).then((database) => {
				this.#connection = database;
				// Replace the generic immediate-close callback so owned media drains
				// and session release can complete before the connection is closed.
				database.onversionchange = () => {
					this.#versionStale = true;
					void this.close().catch(() => undefined);
				};
				this.#assertAccepting();
				return database;
			});
			const attempt = opening.catch((error: unknown) => {
				if (!this.#closeRequested && this.#opening === attempt) this.#opening = null;
				throw error;
			});
			this.#opening = attempt;
		}
		return this.#opening;
	}

	#assertAccepting(): void {
		if (this.#versionStale) throw new EditorStoreVersionStaleError();
		if (this.#closeRequested) throw new EditorStoreClosedError();
	}
}

function namespace(value: unknown): string {
	if (typeof value !== 'string' || value.length > 128 || !/^lightscaper-[a-z0-9][a-z0-9._-]*$/u.test(value)) {
		throw new TypeError('A Photo media namespace requires a bounded Lightscaper name.');
	}
	return value;
}
