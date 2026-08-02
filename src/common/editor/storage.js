import {
	EditorStoreBlockedError,
	EditorStoreClosedError,
	EditorStoreVersionStaleError,
	memoryFallbackReason,
} from './storage/status.ts';
import { openDatabase } from './storage/indexeddb-backend.ts';
import { getMemoryDatabase } from './storage/memory-backend.ts';
import { createStorageRepositories } from './storage/repositories.ts';
import { DesktopSharedProjectRepository } from './storage/desktop-shared-project-repository.ts';
import { admitLocalStoreClear } from './storage/linked-video-original-lifecycle-coordinator.ts';
import { LinkedOriginalStoreService } from './storage/linked-original-store-service.ts';
import { admitProjectPublication } from './storage/project-publication-options.ts';

const DEFAULT_DATABASE_NAME = 'kw-media-audio-editor';

/**
 * Local project/source persistence. IndexedDB is preferred; a process-local
 * memory implementation keeps the editor usable in private or restricted
 * contexts where IndexedDB cannot be opened.
 */
export function createProjectStore(options = {}) {
	return new AudioEditorProjectStore(options);
}

export class AudioEditorProjectStore {
	constructor({
		indexedDB = /** @type {IDBFactory | null} */ (globalThis.indexedDB),
		databaseName = DEFAULT_DATABASE_NAME,
		memoryFallback = true,
		storageManager = globalThis.navigator?.storage,
		opfsRoot = null,
		preferOpfs = true,
		revisionLimit = 20,
		maximumProjectDocumentBytes = undefined,
		pcmCodec = null,
		pcmCodecFactory = null,
		migrateLegacyPcmOnAccess = true,
		derivativeCacheLimits = undefined,
		derivativeCacheNow = undefined,
		linkedOriginalPort = null,
		linkedVideoOriginalPort = null,
		desktopProjectBridge = null,
		onDesktopSharedProjectLocalCleanupError = reportDesktopSharedProjectLocalCleanupError,
		onLinkedVideoOriginalLocatorCleanupError = undefined,
		repositoryFactory = /** @type {import('./storage/repositories.ts').StorageRepositoryFactory} */ (createStorageRepositories),
	} = {}) {
		this.databaseName = databaseName;
		this.indexedDB = indexedDB;
		this.memoryFallback = memoryFallback;
		this.storageManager = storageManager;
		this.opfsRoot = opfsRoot;
		this.preferOpfs = preferOpfs;
		this.revisionLimit = Math.max(2, Math.floor(revisionLimit));
		this.maximumProjectDocumentBytes = maximumProjectDocumentBytes;
		this.backend = indexedDB ? 'indexeddb' : 'memory';
		this.storeState = indexedDB ? 'opening' : 'memory-ephemeral';
		this.degradedReason = indexedDB ? null : 'indexeddb-unavailable';
		this.closed = false;
		this.closing = false;
		this.closeRequested = false;
		this.closePromise = null;
		this.clearPromise = null;
		this.databasePromise = null;
		this.memory = getMemoryDatabase(databaseName);
		const repositories = repositoryFactory({
			memory: this.memory,
			database: () => this.#database(),
		}, {
			revisionLimit: this.revisionLimit,
			preferOpfs,
			storageManager,
			opfsRoot,
			pcmCodec,
			pcmCodecFactory,
			migrateLegacyPcmOnAccess: Boolean(migrateLegacyPcmOnAccess),
			derivativeCacheLimits,
			derivativeCacheNow,
			linkedOriginalPort,
			linkedVideoOriginalPort,
			estimateStorage: () => this.estimateStorage(),
			isMemoryBackend: () => this.backend === 'memory',
		});
		this.projectRepository = desktopProjectBridge
			? new DesktopSharedProjectRepository({
				bridge: desktopProjectBridge,
				shadow: repositories.projects,
				sourceAvailability: {
					getSourceMetadata: (sourceId) => repositories.sources.getMetadata(sourceId),
					readSourceChunks: (sourceId, readOptions) => repositories.sources.chunks(sourceId, readOptions),
					getMediaAssetMetadata: (sourceId) => repositories.media.getAssetMetadata(sourceId),
					loadMediaAsset: (sourceId, loadOptions) => repositories.media.loadAsset(sourceId, loadOptions),
				},
				sourceTransfer: {
					getSourceMetadata: (sourceId) => repositories.sources.getMetadata(sourceId),
					getMediaAssetMetadata: (sourceId) => repositories.media.getAssetMetadata(sourceId),
					loadMediaAsset: (sourceId, loadOptions) => repositories.media.loadAsset(sourceId, loadOptions),
					beginMediaAssetWrite: (sourceId, metadata, writeOptions) => (
						repositories.media.beginAssetWrite(sourceId, metadata, writeOptions)
					),
					readSourceChunks: (sourceId, readOptions) => repositories.sources.chunks(sourceId, readOptions),
					beginSourceWrite: (sourceId, metadata) => repositories.sources.beginWrite(sourceId, metadata),
					discardSourceIfCurrent: (source) => repositories.sources.discardIfCurrent(source),
				},
				linkedVideoOriginals: repositories.linkedVideoOriginals,
				onLocalCleanupError: onDesktopSharedProjectLocalCleanupError,
			})
			: repositories.projects;
		this.settingsRepository = repositories.settings;
		this.analysisRepository = repositories.analysis;
		this.sourceRepository = repositories.sources;
		this.mediaRepository = repositories.media;
		this.linkedOriginalBindingRepository = repositories.linkedOriginalBindings || null;
		this.linkedOriginalProjectAliasRepository = repositories.linkedOriginalProjectAliases || null;
		this.linkedOriginalProjectReachabilityRepository = repositories.linkedOriginalProjectReachability || null;
		this.linkedOriginalResolver = repositories.linkedOriginals || null;
		this.linkedVideoOriginalBindingRepository = repositories.linkedVideoOriginalBindings || null;
		this.linkedVideoOriginalProjectAliasRepository = repositories.linkedVideoOriginalProjectAliases || null;
		this.linkedVideoOriginalProjectReachabilityRepository = repositories.linkedVideoOriginalProjectReachability || null;
		this.linkedVideoOriginalResolver = repositories.linkedVideoOriginals || null;
		this.retentionRepository = repositories.retention;
		this.linkedOriginalStoreService = new LinkedOriginalStoreService(
			repositories,
			{ onCleanupError: onLinkedVideoOriginalLocatorCleanupError },
		);
		this.linkedOriginalLifecycle = this.linkedOriginalStoreService.linkedOriginalLifecycle;
		this.linkedVideoOriginalLifecycle = this.linkedOriginalStoreService.linkedVideoOriginalLifecycle;
	}

	async ready() {
		await this.#database();
		return this;
	}

	getStatus() {
		return Object.freeze({
			state: this.storeState,
			backend: this.backend,
			persistent: this.storeState === 'indexeddb',
			ephemeral: this.backend === 'memory',
			degradedReason: this.degradedReason,
		});
	}

	async saveProject(project, options = {}) {
		return this.linkedOriginalStoreService.saveProject(this, this.projectRepository, project, options);
	}

	async loadProject(projectId, { revision, signal } = {}) {
		return this.projectRepository.load(projectId, { revision, signal });
	}

	async listProjects() {
		return this.projectRepository.list();
	}

	async listProjectRevisions(projectId) {
		return this.projectRepository.listRevisions(projectId);
	}

	async deleteProject(projectId) {
		return this.linkedOriginalStoreService.deleteProject(projectId, () => this.projectRepository.delete(projectId));
	}

	async prepareProjectHandoff(project, { signal } = {}) {
		if (!(this.projectRepository instanceof DesktopSharedProjectRepository)) return Object.freeze([]);
		return this.projectRepository.prepareHandoff(project, signal);
	}

	preservesProjectsOnClear() {
		return this.projectRepository instanceof DesktopSharedProjectRepository;
	}

	async duplicateProject(projectId, { id, title } = {}) {
		return this.linkedOriginalStoreService.duplicateProject({
			loadProject: (requestedId) => this.projectRepository instanceof DesktopSharedProjectRepository
				? this.projectRepository.loadProjectForDuplication(requestedId)
				: this.loadProject(requestedId),
			listProjects: () => this.listProjects(),
			createProjectIfAbsent: async (project) => {
				await admitProjectPublication(this, project);
				const create = this.projectRepository.createIfAbsent;
				if (typeof create !== 'function') throw new Error('Create-only project storage is unavailable.');
				return create.call(this.projectRepository, project);
			},
		}, {
			sourceProjectId: projectId,
			copyProjectId: id || createId('project'),
			title,
			timestamp: new Date().toISOString(),
		});
	}

	async saveSetting(key, value) {
		return this.settingsRepository.put(key, value);
	}

	async loadSetting(key, fallback = null) {
		const value = await this.settingsRepository.get(key);
		return value === undefined ? fallback : value;
	}

	async saveAnalysis(key, value) {
		return this.analysisRepository.put(key, value);
	}

	async loadAnalysis(key) {
		return (await this.analysisRepository.get(key)) ?? null;
	}

	async deleteAnalysis(key) {
		return this.analysisRepository.delete(key);
	}

	/**
	 * Start an atomic, chunked source write. Each `write()` persists its chunk
	 * before resolving, so a recording never needs to retain the whole take.
	 */
	async beginSourceWrite(sourceId, metadata = {}) {
		return this.sourceRepository.beginWrite(sourceId, metadata);
	}

	async writeDerivedSource(sourceId, baseSourceId, replacementChunks, metadata = {}) {
		return this.sourceRepository.writeDerived(sourceId, baseSourceId, replacementChunks, metadata);
	}

	async writeAudioBuffer(sourceId, audioBuffer, metadata = {}, { chunkFrames = 65_536 } = {}) {
		return this.sourceRepository.writeAudioBuffer(sourceId, audioBuffer, metadata, { chunkFrames });
	}

	async getSourceMetadata(sourceId) {
		return this.sourceRepository.getMetadata(sourceId);
	}

	async listSources() {
		return this.sourceRepository.list();
	}

	/**
	 * Persist the immutable original container for a media source. OPFS keeps
	 * large files out of IndexedDB when it is available; the Blob-backed record
	 * is the complete fallback and is also used by the in-memory backend.
	 */
	async writeMediaAsset(sourceId, input, metadata = {}, { signal } = {}) {
		return this.mediaRepository.writeAsset(sourceId, input, metadata, { signal });
	}

	/** Start a bounded transactional write without retaining the whole container. */
	async beginMediaAssetWrite(sourceId, metadata = {}, options = {}) {
		return this.mediaRepository.beginAssetWrite(sourceId, metadata, options);
	}

	async loadMediaAsset(sourceId, options = {}) {
		return this.mediaRepository.loadAsset(sourceId, options);
	}

	async getMediaAssetMetadata(sourceId) {
		return this.mediaRepository.getAssetMetadata(sourceId);
	}

	async bindLinkedAudioOriginal(projectId, source, locatorId, options = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.bindAudio(projectId, source, locatorId, options);
	}

	async resolveLinkedAudioOriginal(projectId, source, options = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.resolveAudio(projectId, source, options);
	}

	async getLinkedAudioOriginalMetadata(projectId, source) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.metadataAudio(projectId, source);
	}

	async getLinkedOriginalBinding(projectId, sourceId) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.getBinding(projectId, sourceId);
	}

	async unlinkLinkedAudioOriginal(projectId, sourceId, expectedBindingToken) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.unlinkAudio(projectId, sourceId, expectedBindingToken);
	}

	async releaseLinkedOriginalLocator(reference) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.releaseOriginal(reference);
	}

	async bindLinkedVideoOriginal(projectId, source, locatorId, options = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.bindVideo(projectId, source, locatorId, options);
	}

	/** Resolve one exact project/video binding without consulting retained-media storage. */
	async resolveLinkedVideoOriginal(projectId, source, options = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.resolveVideo(projectId, source, options);
	}
	async leaseLinkedVideoOriginalPlayback(projectId, source, options = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.leaseVideoPlayback(projectId, source, options);
	}

	async getLinkedVideoOriginalMetadata(projectId, source) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.metadataVideo(projectId, source);
	}

	async getLinkedVideoOriginalBinding(projectId, sourceId) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.getVideoBinding(projectId, sourceId);
	}

	async unlinkLinkedVideoOriginal(projectId, sourceId, expectedBindingToken) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.unlinkVideo(projectId, sourceId, expectedBindingToken);
	}

	/** Release a platform locator that was not retained by a committed import. */
	async releaseLinkedVideoOriginalLocator(reference) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.releaseVideo(reference);
	}

	/** Reconcile main-private startup locators only from a complete durable binding inventory. */
	async reconcileLinkedVideoOriginalLocators() {
		this.#assertOpen();
		return this.linkedOriginalStoreService.reconcileVideoLocators({
			isDurable: async () => await this.#database() !== null,
			projectIds: async () => (await this.projectRepository.list()).map(({ id }) => id),
		});
	}

	async reconcileLinkedOriginalLocators() {
		this.#assertOpen();
		return this.linkedOriginalStoreService.reconcileOriginalLocators({
			isDurable: async () => await this.#database() !== null,
			projectIds: async () => (await this.projectRepository.list()).map(({ id }) => id),
		});
	}

	/**
	 * Remove a raw media asset and all of its cached derivatives. Timeline
	 * source metadata is deliberately left alone; `deleteSource()` owns that
	 * complete lifecycle.
	 */
	async deleteMediaAsset(sourceId) {
		return this.mediaRepository.deleteAsset(sourceId);
	}

	/**
	 * Save or replace one reproducible poster or thumbnail at an exact source
	 * timestamp. Editorial proxies remain a separate later relationship.
	 */
	async saveVideoDerivative(sourceId, {
		timestamp = 0,
		type,
		recipe,
		blob: input,
		metadata = {},
	} = {}) {
		return this.mediaRepository.saveDerivative(sourceId, {
			timestamp,
			type,
			recipe,
			blob: input,
			metadata,
		});
	}

	async saveLinkedVideoDerivative(projectId, source, binding, input = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.saveLinkedVideoDerivative(projectId, source, binding, input);
	}

	async loadVideoDerivative(sourceId, { timestamp = 0, type, recipe } = {}) {
		return this.mediaRepository.loadDerivative(sourceId, { timestamp, type, recipe });
	}

	async loadLinkedVideoDerivative(projectId, source, binding, selector = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.loadLinkedVideoDerivative(projectId, source, binding, selector);
	}

	async listVideoDerivatives(sourceId, { type, recipe } = {}) {
		return this.mediaRepository.listDerivatives(sourceId, { type, recipe });
	}

	async listLinkedVideoDerivatives(projectId, source, binding, selector = {}) {
		this.#assertOpen();
		return this.linkedOriginalStoreService.listLinkedVideoDerivatives(projectId, source, binding, selector);
	}

	async deleteVideoDerivative(sourceId, selector = {}) {
		return this.mediaRepository.deleteDerivative(sourceId, selector);
	}

	/**
	 * Enforce explicit limits on reproducible video previews only. Durable
	 * projects, revision history, original media, and canonical PCM are outside
	 * this repository operation by construction.
	 */
	async trimVideoDerivativeCache({ maximumBytes, maximumEntries, maximumAgeMs, now } = {}) {
		return this.mediaRepository.trimDerivatives({ maximumBytes, maximumEntries, maximumAgeMs, now });
	}

	async *readSourceChunks(sourceId, options = {}) {
		yield* this.sourceRepository.chunks(sourceId, options);
	}

	async readSourceChunk(sourceId, chunkIndex, options = {}) {
		return this.sourceRepository.chunk(sourceId, chunkIndex, options);
	}

	async loadSourceAudioBuffer(sourceId, audioContext) {
		return this.sourceRepository.loadAudioBuffer(sourceId, audioContext);
	}

	async deleteSource(sourceId) {
		return this.sourceRepository.delete(sourceId);
	}

	async discardSourceIfCurrent(source) {
		return this.sourceRepository.discardIfCurrent(source);
	}

	/** Delete source data unreachable from durable and caller-provided roots. */
	pruneUnreferencedSources(options = {}) {
		return this.retentionRepository.prune(options);
	}

	async cleanupTemporaryAssets({ maximumAgeMs = 24 * 60 * 60 * 1000 } = {}) {
		return this.retentionRepository.cleanupTemporaryAssets({ maximumAgeMs });
	}

	async estimateStorage() {
		this.#assertOpen();
		if (!this.storageManager?.estimate) return { usage: null, quota: null };
		try {
			const result = await this.storageManager.estimate();
			return { usage: result.usage ?? null, quota: result.quota ?? null };
		} catch {
			return { usage: null, quota: null };
		}
	}

	async requestPersistentStorage() {
		this.#assertOpen();
		if (this.backend !== 'indexeddb') return false;
		if (!this.storageManager?.persist) return false;
		try {
			return Boolean(await this.storageManager.persist());
		} catch {
			return false;
		}
	}

	supportsPersistentStorage() {
		this.#assertOpen();
		return this.backend === 'indexeddb' && typeof this.storageManager?.persist === 'function';
	}

	async queryPersistentStorage() {
		this.#assertOpen();
		if (this.backend !== 'indexeddb') return null;
		if (!this.storageManager?.persisted) return null;
		try {
			return Boolean(await this.storageManager.persisted());
		} catch {
			return null;
		}
	}

	clear() {
		this.#assertOpen();
		if (!this.clearPromise) {
			const admission = admitLocalStoreClear(this.retentionRepository);
			const operation = this.linkedOriginalStoreService.clear(
				admission,
			);
			this.clearPromise = operation;
			void operation.then(
				() => { if (this.clearPromise === operation) this.clearPromise = null; },
				() => { if (this.clearPromise === operation) this.clearPromise = null; },
			);
		}
		return this.clearPromise;
	}

	close() {
		if (this.closePromise) return this.closePromise;
		if (this.closed) return Promise.resolve();
		this.closePromise = this.#close();
		return this.closePromise;
	}

	async #close() {
		const mediaMaintenance = this.mediaRepository.beginAssetMaintenance({ permanent: true });
		this.closeRequested = true;
		this.storeState = 'closing';
		const closeErrors = [];
		const clearing = this.clearPromise;
		if (clearing) {
			try {
				await clearing;
			} catch (error) {
				closeErrors.push(error);
			}
		}
		this.closing = true;
		try {
			await mediaMaintenance.abortActive();
		} catch (error) {
			closeErrors.push(error);
		}
		try {
			await this.sourceRepository.stopBackgroundWork({ closeCodec: true });
		} catch (error) {
			closeErrors.push(error);
		} finally {
			const database = this.databasePromise
				? await this.databasePromise.catch(() => null)
				: null;
			if (database) database.onversionchange = null;
			database?.close();
			this.databasePromise = null;
			this.closed = true;
			this.closing = false;
			this.storeState = 'closed';
		}
		if (closeErrors.length === 1) throw closeErrors[0];
		if (closeErrors.length > 1) throw new AggregateError(closeErrors, 'Project storage close failed.');
	}

	#assertOpen() {
		if (this.closed || this.closing || this.closeRequested) throw new EditorStoreClosedError();
		if (this.storeState === 'version-stale') throw new EditorStoreVersionStaleError();
	}

	async #database() {
		this.#assertOpen();
		if (this.backend === 'memory') return null;
		if (!this.databasePromise) {
			this.storeState = 'opening';
			this.databasePromise = openDatabase(this.indexedDB, this.databaseName, () => {
				this.databasePromise = null;
				this.storeState = 'version-stale';
				this.degradedReason = 'versionchange';
			}).then((database) => {
				if (this.closed || this.closing) {
					database.close();
					throw new EditorStoreClosedError();
				}
				this.storeState = 'indexeddb';
				this.degradedReason = null;
				return database;
			}).catch((error) => {
				this.databasePromise = null;
				const closeBlocksFallback = this.closeRequested && !this.clearPromise;
				if (this.closed || this.closing || closeBlocksFallback || error instanceof EditorStoreClosedError) throw error;
				const fallbackReason = memoryFallbackReason(error);
				if (!this.memoryFallback || !fallbackReason) {
					this.storeState = error instanceof EditorStoreBlockedError ? 'version-stale' : 'error';
					this.degradedReason = error instanceof EditorStoreBlockedError ? 'blocked' : String(error?.name || 'open-failed');
					throw error;
				}
				this.backend = 'memory';
				this.storeState = 'memory-ephemeral';
				this.degradedReason = fallbackReason;
				return null;
			});
		}
		return this.databasePromise;
	}
}

function createId(prefix) {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function reportDesktopSharedProjectLocalCleanupError() {
	globalThis.console?.error?.('A deleted shared project could not be removed from this product local cache.');
}
