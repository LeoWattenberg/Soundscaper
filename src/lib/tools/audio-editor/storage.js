import { collectProjectSourceIds, compactProjectSourceMetadata } from './retention.js';
import {
	PCM_CONTAINER_EXTENSION,
	PCM_CONTAINER_STORAGE_TYPE,
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	PcmContainerWriter,
	PcmStorageCorruptionError,
	WAVPACK_PCM_MAXIMUM_FRAMES,
	WavPackCodecClient,
	compressionStatistics,
	containerCodecToEncoding,
	crc32,
	exactArrayBuffer,
	minimumWavPackSavings,
	normalizePcmSampleRate,
	packPlanarFloat32,
	parsePcmContainerIndex,
	pcmRawByteLength,
	readPcmContainerPayload,
	unpackPlanarFloat32,
} from './wavpack/index.js';

const DATABASE_VERSION = 2;
const DEFAULT_DATABASE_NAME = 'kw-media-audio-editor';
const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;
const SOURCE_CHUNK_CURSOR_PAGE_SIZE = 8;
const memoryDatabases = new Map();

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
		indexedDB = globalThis.indexedDB,
		databaseName = DEFAULT_DATABASE_NAME,
		memoryFallback = true,
		storageManager = globalThis.navigator?.storage,
		opfsRoot = null,
		preferOpfs = true,
		revisionLimit = 20,
		pcmCodec = null,
		pcmCodecFactory = null,
		migrateLegacyPcmOnAccess = true,
	} = {}) {
		this.databaseName = databaseName;
		this.indexedDB = indexedDB;
		this.memoryFallback = memoryFallback;
		this.storageManager = storageManager;
		this.opfsRoot = opfsRoot;
		this.preferOpfs = preferOpfs;
		this.revisionLimit = Math.max(2, Math.floor(revisionLimit));
		this.opfsDirectoryPromise = null;
		this.backend = indexedDB ? 'indexeddb' : 'memory';
		this.databasePromise = null;
		this.memory = getMemoryDatabase(databaseName);
		this.sourcePrunePromise = Promise.resolve();
		this.pcmCodec = pcmCodec;
		this.pcmCodecFactory = pcmCodecFactory || (() => new WavPackCodecClient());
		this.ownsPcmCodec = !pcmCodec;
		this.pcmCodecCircuitOpen = false;
		this.migrateLegacyPcmOnAccess = Boolean(migrateLegacyPcmOnAccess);
		this.pcmContainerIndexCache = new Map();
		this.legacyMigrationPromises = new Map();
		this.legacyMigrationFailures = new Set();
		this.legacyMigrationControllers = new Map();
	}

	async ready() {
		await this.#database();
		return this;
	}

	async saveProject(project) {
		if (!project || typeof project.id !== 'string' || !project.id) {
			throw new Error('A project with a stable string id is required.');
		}
		const snapshot = compactProjectSourceMetadata(clone(project));
		const revision = nonNegativeInteger(snapshot.revision, 0);
		const revisionRecord = {
			key: revisionKey(snapshot.id, revision),
			projectId: snapshot.id,
			revision,
			project: snapshot,
		};
		const database = await this.#database();
		if (!database) {
			this.memory.projects.set(snapshot.id, snapshot);
			this.memory.revisions.set(revisionRecord.key, revisionRecord);
			for (const sourceId of collectProjectSourceIds(snapshot)) {
				const source = this.memory.sources.get(sourceId);
				if (source?.pendingProjectUntil) this.memory.sources.set(sourceId, publishSource(source));
				const mediaAsset = this.memory.mediaAssets.get(sourceId);
				if (mediaAsset?.pendingProjectUntil) this.memory.mediaAssets.set(sourceId, publishSource(mediaAsset));
			}
			await this.#pruneProjectRevisions(snapshot.id);
			return clone(snapshot);
		}

		await transact(database, ['projects', 'revisions', 'sources', 'mediaAssets'], 'readwrite', async ({
			projects,
			revisions,
			sources,
			mediaAssets,
		}) => {
			projects.put(snapshot);
			revisions.put(revisionRecord);
			for (const sourceId of collectProjectSourceIds(snapshot)) {
				const source = await request(sources.get(sourceId));
				if (source?.pendingProjectUntil) sources.put(publishSource(source));
				const mediaAsset = await request(mediaAssets.get(sourceId));
				if (mediaAsset?.pendingProjectUntil) mediaAssets.put(publishSource(mediaAsset));
			}
		});
		await this.#pruneProjectRevisions(snapshot.id);
		return clone(snapshot);
	}

	async loadProject(projectId, { revision } = {}) {
		const database = await this.#database();
		if (!database) {
			const value = revision === undefined
				? this.memory.projects.get(projectId)
				: this.memory.revisions.get(revisionKey(projectId, revision))?.project;
			return value ? clone(compactProjectSourceMetadata(value)) : null;
		}

		const storeName = revision === undefined ? 'projects' : 'revisions';
		const key = revision === undefined ? projectId : revisionKey(projectId, revision);
		const value = await transact(database, storeName, 'readonly', (stores) => request(stores[storeName].get(key)));
		return value ? clone(compactProjectSourceMetadata(value.project || value)) : null;
	}

	async listProjects() {
		const database = await this.#database();
		if (!database) {
			return [...this.memory.projects.values()].map((project) => clone(compactProjectSourceMetadata(project))).sort(sortProjects);
		}
		const projects = await transact(database, 'projects', 'readonly', ({ projects }) => request(projects.getAll()));
		return projects.map((project) => clone(compactProjectSourceMetadata(project))).sort(sortProjects);
	}

	async listProjectRevisions(projectId) {
		const database = await this.#database();
		let records;
		if (!database) {
			records = [...this.memory.revisions.values()].filter((record) => record.projectId === projectId);
		} else {
			records = await transact(database, 'revisions', 'readonly', ({ revisions }) => {
				return request(revisions.index('projectId').getAll(projectId));
			});
		}
		return records.sort((left, right) => right.revision - left.revision).map((record) => ({
			revision: record.revision,
			project: clone(compactProjectSourceMetadata(record.project)),
		}));
	}

	async deleteProject(projectId) {
		const database = await this.#database();
		if (!database) {
			this.memory.projects.delete(projectId);
			for (const [key, record] of this.memory.revisions) {
				if (record.projectId === projectId) this.memory.revisions.delete(key);
			}
			return;
		}
		await transact(database, ['projects', 'revisions'], 'readwrite', async ({ projects, revisions }) => {
			projects.delete(projectId);
			await deleteByIndex(revisions.index('projectId'), projectId);
		});
	}

	async duplicateProject(projectId, { id, title } = {}) {
		const source = await this.loadProject(projectId);
		if (!source) throw new Error('The project to duplicate could not be found.');
		const timestamp = new Date().toISOString();
		const copy = {
			...source,
			id: id || createId('project'),
			title: title || `${source.title || 'Untitled'} copy`,
			revision: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		return this.saveProject(copy);
	}

	async saveSetting(key, value) {
		return this.#putKeyValue('settings', key, value);
	}

	async loadSetting(key, fallback = null) {
		const value = await this.#getKeyValue('settings', key);
		return value === undefined ? fallback : value;
	}

	async saveAnalysis(key, value) {
		return this.#putKeyValue('analysis', key, value);
	}

	async loadAnalysis(key) {
		return (await this.#getKeyValue('analysis', key)) ?? null;
	}

	async deleteAnalysis(key) {
		const database = await this.#database();
		if (!database) this.memory.analysis.delete(key);
		else await transact(database, 'analysis', 'readwrite', ({ analysis }) => { analysis.delete(key); });
	}

	/**
	 * Start an atomic, chunked source write. Each `write()` persists its chunk
	 * before resolving, so a recording never needs to retain the whole take.
	 */
	async beginSourceWrite(sourceId, metadata = {}) {
		if (!sourceId) throw new Error('A source id is required.');
		const writeSampleRate = normalizePcmSampleRate(metadata.sampleRate ?? 48_000);
		const declaredChunkFrames = metadata.chunkFrames == null
			? null
			: normalizePcmChunkFrames(metadata.chunkFrames);
		const database = await this.#database();
		const token = `${sourceId}:pending:${createId('write')}`;
		const opfsWriter = await this.#createOpfsWriter(token, metadata);
		const persistEncodedChunks = Boolean(opfsWriter || database);
		let chunkIndex = 0;
		let totalFrames = 0;
		let channelCount = null;
		let nominalChunkFrames = null;
		let opfsChunkFrames = null;
		let previousChunkFrames = null;
		let regularChunkLayout = true;
		let uncompressedBytes = 0;
		let storedBytes = 0;
		let wavpackChunkCount = 0;
		let rawChunkCount = 0;
		let closed = false;
		const store = this;

		return {
			get framesWritten() { return totalFrames; },
			async write(inputChannels) {
				if (closed) throw new Error('The source writer is closed.');
				const channels = normalizeChannels(inputChannels);
				if (!channels.length) return;
				const frameLength = channels[0].length;
				if (channels.some((channel) => channel.length !== frameLength)) {
					throw new Error('All source channels must contain the same number of frames.');
				}
				if (channelCount === null) channelCount = channels.length;
				if (channels.length !== channelCount) throw new Error('Source channel count changed during a write.');
				if (nominalChunkFrames === null) nominalChunkFrames = frameLength;
				else if (previousChunkFrames !== nominalChunkFrames || frameLength > nominalChunkFrames) regularChunkLayout = false;
				previousChunkFrames = frameLength;
				let storedChunk;
				if (persistEncodedChunks) {
					const rawPayload = packPlanarFloat32(channels);
					storedChunk = await store.#encodePcmPayload(rawPayload, {
						frames: frameLength,
						channelCount,
						sampleRate: writeSampleRate,
						priority: 'foreground',
						allowRawOnFailure: true,
					});
				} else {
					const snapshots = channels.map((channel) => channel.slice());
					const rawBytes = snapshots.reduce((sum, channel) => sum + channel.byteLength, 0);
					storedChunk = {
						encoding: null,
						channels: snapshots.map((channel) => channel.buffer),
						pcmCrc32: crc32(packPlanarFloat32(snapshots)),
						uncompressedBytes: rawBytes,
						storedBytes: rawBytes,
					};
				}
				const record = {
					key: `${token}:${String(chunkIndex).padStart(10, '0')}`,
					sourceToken: token,
					index: chunkIndex,
					frames: frameLength,
					...(storedChunk.encoding
						? {
							encoding: storedChunk.encoding,
							payload: storedChunk.payload,
							pcmCrc32: storedChunk.pcmCrc32,
						}
						: { channels: storedChunk.channels }),
					createdAt: Date.now(),
				};
				if (opfsWriter) {
					const writerChunkFrames = positiveInteger(
						declaredChunkFrames ?? nominalChunkFrames,
						0,
					);
					if (!writerChunkFrames) throw new RangeError('A positive source chunk size is required.');
					if (opfsChunkFrames === null) opfsChunkFrames = writerChunkFrames;
					await opfsWriter.write({
						...storedChunk,
						frames: frameLength,
						channelCount,
						sampleRate: writeSampleRate,
						chunkFrames: opfsChunkFrames,
					});
				} else {
					await store.#writeSourceChunk(record);
				}
				chunkIndex += 1;
				totalFrames += frameLength;
				uncompressedBytes += storedChunk.uncompressedBytes;
				storedBytes += storedChunk.storedBytes;
				if (storedChunk.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
				else rawChunkCount += 1;
			},
			async commit(extraMetadata = {}) {
				if (closed) throw new Error('The source writer is closed.');
				if (!chunkIndex || !channelCount || !totalFrames) {
					throw new Error('A persisted audio source must contain at least one PCM frame.');
				}
				if (extraMetadata.sampleRate != null
					&& normalizePcmSampleRate(extraMetadata.sampleRate) !== writeSampleRate) {
					throw new Error('Source sample rate changed between beginSourceWrite() and commit().');
				}
				const declaredChannelCount = extraMetadata.channelCount ?? metadata.channelCount;
				if (declaredChannelCount != null && Number(declaredChannelCount) !== channelCount) {
					throw new Error('Source channel count changed between beginSourceWrite() and commit().');
				}
				const requestedChunkFrames = extraMetadata.chunkFrames
					?? declaredChunkFrames
					?? (opfsWriter ? opfsChunkFrames : (regularChunkLayout ? nominalChunkFrames : null));
				const committedChunkFrames = requestedChunkFrames == null
					? null
					: normalizePcmChunkFrames(requestedChunkFrames);
				if (opfsWriter && opfsChunkFrames !== null && committedChunkFrames !== opfsChunkFrames) {
					throw new Error('Source chunk size changed between beginSourceWrite() and commit().');
				}
				closed = true;
				await store.#cancelLegacyPcmMigration(sourceId);
				const previous = await store.getSourceMetadata(sourceId);
				let writerStatistics;
				try {
					writerStatistics = opfsWriter ? await opfsWriter.close() : null;
				} catch (error) {
					await opfsWriter?.abort().catch(() => undefined);
					throw error;
				}
				const statistics = writerStatistics || compressionStatistics({
					uncompressedBytes,
					storedBytes,
					wavpackChunkCount,
					rawChunkCount,
				});
				const record = {
					...clone(metadata),
					...clone(extraMetadata),
					id: sourceId,
					storage: opfsWriter ? PCM_CONTAINER_STORAGE_TYPE : 'indexeddb-chunks',
					sourceToken: token,
					path: opfsWriter?.path,
					channelCount: channelCount || nonNegativeInteger(metadata.channelCount, 0),
					sampleRate: writeSampleRate,
					frameLength: totalFrames,
					frameCount: totalFrames,
					chunkFrames: committedChunkFrames,
					chunkCount: chunkIndex,
					pcmEncodingVersion: persistEncodedChunks ? 1 : undefined,
					...statistics,
					committedAt: new Date().toISOString(),
					pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
				};
				try {
					await store.#putSourceMetadata(record);
				} catch (error) {
					if (opfsWriter) await opfsWriter.remove();
					else await store.#deleteSourceChunks(token);
					throw error;
				}
				if (previous) await store.#deleteStoredSource(previous);
				return clone(record);
			},
			async abort() {
				if (closed) return;
				closed = true;
				if (opfsWriter) await opfsWriter.abort();
				else await store.#deleteSourceChunks(token);
			},
		};
	}

	/**
	 * Atomically publish a sparse copy-on-write source. Replacement chunks are
	 * immutable overlays; every untouched chunk remains owned by `baseSourceId`.
	 */
	async writeDerivedSource(sourceId, baseSourceId, replacementChunks, metadata = {}) {
		if (!sourceId || !baseSourceId || sourceId === baseSourceId) throw new Error('Distinct source and base source ids are required.');
		if (!Array.isArray(replacementChunks) || !replacementChunks.length) throw new Error('At least one replacement source chunk is required.');
		const incomingChunks = replacementChunks.map((input) => ({
			index: input?.index,
			channels: normalizeChannels(input?.channels).map((channel) => channel.slice()),
		}));
		const base = await this.getSourceMetadata(baseSourceId);
		if (!base) throw new Error('The immutable base source could not be found.');
		if (await this.getSourceMetadata(sourceId)) throw new Error('Immutable source ids cannot be overwritten.');
		const channelCount = positiveInteger(base.channelCount, 64);
		const frameCount = positiveInteger(base.frameCount ?? base.frameLength, Number.MAX_SAFE_INTEGER);
		const chunkFrames = normalizePcmChunkFrames(metadata.chunkFrames ?? base.chunkFrames ?? 65_536);
		const expectedChunkCount = Math.ceil(frameCount / chunkFrames);
		const token = `${sourceId}:cow:${createId('write')}`;
		const seenIndices = new Set();
		const chunks = incomingChunks.map((input, replacementIndex) => {
			const index = nonNegativeInteger(input?.index, -1);
			if (index < 0 || index >= expectedChunkCount || seenIndices.has(index)) throw new Error('A derived source contains an invalid replacement chunk index.');
			seenIndices.add(index);
			const channels = input.channels;
			if (channels.length !== channelCount) throw new Error('A derived source replacement has the wrong channel count.');
			const expectedFrames = index === expectedChunkCount - 1 ? frameCount - index * chunkFrames : chunkFrames;
			if (channels[0]?.length !== expectedFrames) throw new Error('A derived source replacement has the wrong frame count.');
			return {
				key: `${token}:${String(index).padStart(10, '0')}`,
				sourceToken: token,
				index,
				frames: expectedFrames,
				channels,
				createdAt: Date.now() + replacementIndex,
			};
		});
		const database = await this.#database();
		let uncompressedBytes = 0;
		let storedBytes = 0;
		let wavpackChunkCount = 0;
		let rawChunkCount = 0;
		try {
			for (const chunk of chunks) {
				let record;
				if (database) {
					const storedChunk = await this.#encodePcmPayload(packPlanarFloat32(chunk.channels), {
						frames: chunk.frames,
						channelCount,
						sampleRate: metadata.sampleRate ?? base.sampleRate ?? 48_000,
						priority: 'foreground',
						allowRawOnFailure: true,
					});
					record = {
						key: chunk.key,
						sourceToken: token,
						index: chunk.index,
						frames: chunk.frames,
						encoding: storedChunk.encoding,
						payload: storedChunk.payload,
						pcmCrc32: storedChunk.pcmCrc32,
						createdAt: chunk.createdAt,
					};
					uncompressedBytes += storedChunk.uncompressedBytes;
					storedBytes += storedChunk.storedBytes;
					if (storedChunk.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
					else rawChunkCount += 1;
				} else {
					record = {
						key: chunk.key,
						sourceToken: token,
						index: chunk.index,
						frames: chunk.frames,
						channels: chunk.channels.map((channel) => channel.buffer.slice(0)),
						createdAt: chunk.createdAt,
					};
					const rawBytes = chunk.frames * channelCount * Float32Array.BYTES_PER_ELEMENT;
					uncompressedBytes += rawBytes;
					storedBytes += rawBytes;
					rawChunkCount += 1;
				}
				await this.#writeSourceChunk(record);
			}
		} catch (error) {
			await this.#deleteSourceChunks(token);
			throw error;
		}
		const statistics = compressionStatistics({
			uncompressedBytes,
			storedBytes,
			wavpackChunkCount,
			rawChunkCount,
		});
		const record = {
			...clone(metadata),
			id: sourceId,
			storage: 'copy-on-write',
			baseSourceId,
			sourceToken: token,
			channelCount,
			frameLength: frameCount,
			frameCount,
			chunkFrames,
			chunkCount: expectedChunkCount,
			overrideChunkCount: chunks.length,
			sampleRate: metadata.sampleRate ?? base.sampleRate,
			pcmEncodingVersion: database ? 1 : undefined,
			...statistics,
			committedAt: new Date().toISOString(),
			pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
		};
		try {
			await this.#putSourceMetadata(record);
		} catch (error) {
			await this.#deleteSourceChunks(token);
			throw error;
		}
		return clone(record);
	}

	/** Persist an AudioBuffer in bounded chunks without an intermediate copy. */
	async writeAudioBuffer(sourceId, audioBuffer, metadata = {}, { chunkFrames = 65_536 } = {}) {
		if (!audioBuffer?.numberOfChannels || !audioBuffer?.length || !audioBuffer?.getChannelData) {
			throw new TypeError('A non-empty AudioBuffer is required.');
		}
		const boundedChunkFrames = normalizePcmChunkFrames(chunkFrames ?? 65_536);
		const writer = await this.beginSourceWrite(sourceId, {
			...metadata,
			sampleRate: audioBuffer.sampleRate,
			channelCount: audioBuffer.numberOfChannels,
			chunkFrames: boundedChunkFrames,
		});
		try {
			for (let offset = 0; offset < audioBuffer.length; offset += boundedChunkFrames) {
				const end = Math.min(audioBuffer.length, offset + boundedChunkFrames);
				const channels = Array.from(
					{ length: audioBuffer.numberOfChannels },
					(_, channel) => audioBuffer.getChannelData(channel).subarray(offset, end),
				);
				await writer.write(channels);
			}
			return await writer.commit();
		} catch (error) {
			await writer.abort();
			throw error;
		}
	}

	async getSourceMetadata(sourceId) {
		const database = await this.#database();
		if (!database) return clone(this.memory.sources.get(sourceId) || null);
		const value = await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.get(sourceId)));
		return value ? clone(value) : null;
	}

	async listSources() {
		const database = await this.#database();
		const values = !database
			? [...this.memory.sources.values()]
			: await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.getAll()));
		return values.map(clone);
	}

	/**
	 * Persist the immutable original container for a media source. OPFS keeps
	 * large files out of IndexedDB when it is available; the Blob-backed record
	 * is the complete fallback and is also used by the in-memory backend.
	 */
	async writeMediaAsset(sourceId, input, metadata = {}) {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const blob = normalizeBlob(input);
		if (await this.getMediaAssetMetadata(id)) {
			throw new Error(`Immutable media asset ${id} cannot be overwritten.`);
		}
		const storedFile = await this.#writeOpfsBlob(`media-${id}`, blob);
		const record = {
			...binaryMetadata(metadata),
			sourceId: id,
			storage: storedFile ? 'opfs' : 'indexeddb-blob',
			path: storedFile?.path,
			blob: storedFile ? undefined : blob,
			size: blob.size,
			mimeType: String(metadata.mimeType || blob.type || ''),
			name: String(metadata.name || input?.name || ''),
			lastModified: nonNegativeInteger(metadata.lastModified ?? input?.lastModified, 0),
			committedAt: new Date().toISOString(),
			pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
		};
		try {
			const database = await this.#database();
			if (!database) this.memory.mediaAssets.set(id, clone(record));
			else await transact(database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => { mediaAssets.put(record); });
		} catch (error) {
			if (storedFile) await this.#deleteOpfsPath(storedFile.path);
			throw error;
		}
		return mediaAssetMetadata(record);
	}

	async loadMediaAsset(sourceId) {
		const record = await this.#mediaAssetRecord(sourceId);
		if (!record) return null;
		return this.#loadBinaryRecord(record, 'The requested local media asset is missing.');
	}

	async getMediaAssetMetadata(sourceId) {
		const record = await this.#mediaAssetRecord(sourceId);
		return record ? mediaAssetMetadata(record) : null;
	}

	/**
	 * Remove a raw media asset and all of its cached derivatives. Timeline
	 * source metadata is deliberately left alone; `deleteSource()` owns that
	 * complete lifecycle.
	 */
	async deleteMediaAsset(sourceId) {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const database = await this.#database();
		let record;
		let derivatives;
		if (!database) {
			record = clone(this.memory.mediaAssets.get(id) || null);
			derivatives = [...this.memory.videoDerivatives.values()]
				.filter((candidate) => candidate.sourceId === id)
				.map(clone);
			this.memory.mediaAssets.delete(id);
			for (const derivative of derivatives) this.memory.videoDerivatives.delete(derivative.key);
		} else {
			({ record, derivatives } = await transact(
				database,
				['mediaAssets', 'videoDerivatives'],
				'readwrite',
				async ({ mediaAssets, videoDerivatives }) => {
					const storedRecord = await request(mediaAssets.get(id));
					const storedDerivatives = await request(videoDerivatives.index('sourceId').getAll(id));
					mediaAssets.delete(id);
					await deleteByIndex(videoDerivatives.index('sourceId'), id);
					return { record: storedRecord || null, derivatives: storedDerivatives };
				},
			));
		}
		await this.#deleteBinaryRecords([record, ...derivatives]);
	}

	/**
	 * Save or replace one derived video artifact (for example, a poster,
	 * thumbnail, or preview proxy) at an exact source timestamp.
	 */
	async saveVideoDerivative(sourceId, {
		timestamp = 0,
		type,
		blob: input,
		metadata = {},
	} = {}) {
		const identity = videoDerivativeIdentity(sourceId, timestamp, type);
		const blob = normalizeBlob(input);
		const previous = await this.#videoDerivativeRecord(identity.key);
		const storedFile = await this.#writeOpfsBlob(`video-${identity.sourceId}-${identity.type}`, blob);
		const record = {
			...binaryMetadata(metadata),
			...identity,
			storage: storedFile ? 'opfs' : 'indexeddb-blob',
			path: storedFile?.path,
			blob: storedFile ? undefined : blob,
			size: blob.size,
			mimeType: String(metadata.mimeType || blob.type || ''),
			committedAt: new Date().toISOString(),
		};
		try {
			const database = await this.#database();
			if (!database) this.memory.videoDerivatives.set(record.key, clone(record));
			else await transact(database, 'videoDerivatives', 'readwrite', ({ videoDerivatives }) => { videoDerivatives.put(record); });
		} catch (error) {
			if (storedFile) await this.#deleteOpfsPath(storedFile.path);
			throw error;
		}
		if (previous?.path !== record.path) await this.#deleteBinaryRecords([previous]);
		return videoDerivativeMetadata(record);
	}

	async loadVideoDerivative(sourceId, { timestamp = 0, type } = {}) {
		const identity = videoDerivativeIdentity(sourceId, timestamp, type);
		const record = await this.#videoDerivativeRecord(identity.key);
		if (!record) return null;
		return this.#loadBinaryRecord(record, 'The requested local video derivative is missing.');
	}

	async listVideoDerivatives(sourceId, { type } = {}) {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const requestedType = type === undefined ? null : nonEmptyString(type, 'A video derivative type is required.');
		const records = await this.#videoDerivativeRecords(id);
		return records
			.filter((record) => requestedType === null || record.type === requestedType)
			.sort((left, right) => left.timestamp - right.timestamp || left.type.localeCompare(right.type))
			.map(videoDerivativeMetadata);
	}

	async deleteVideoDerivative(sourceId, selector = {}) {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const hasTimestamp = selector.timestamp !== undefined;
		const hasType = selector.type !== undefined;
		const timestamp = hasTimestamp ? nonNegativeFiniteNumber(selector.timestamp, 'A non-negative derivative timestamp is required.') : null;
		const type = hasType ? nonEmptyString(selector.type, 'A video derivative type is required.') : null;
		const records = (await this.#videoDerivativeRecords(id)).filter((record) => (
			(timestamp === null || record.timestamp === timestamp)
			&& (type === null || record.type === type)
		));
		if (!records.length) return;
		const database = await this.#database();
		if (!database) {
			for (const record of records) this.memory.videoDerivatives.delete(record.key);
		} else {
			await transact(database, 'videoDerivatives', 'readwrite', ({ videoDerivatives }) => {
				for (const record of records) videoDerivatives.delete(record.key);
			});
		}
		await this.#deleteBinaryRecords(records);
	}

	async *readSourceChunks(sourceId) {
		yield* this.#readSourceChunks(sourceId, new Set());
	}

	/**
	 * Demand-load one immutable storage chunk. This is the random-access bridge
	 * used by the long-source worker, so playback does not scan or materialize
	 * every earlier chunk before satisfying a request.
	 */
	async readSourceChunk(sourceId, chunkIndex, { signal } = {}) {
		const index = nonNegativeInteger(chunkIndex, -1);
		if (index < 0) throw new RangeError('Source chunk index must be a non-negative integer.');
		throwIfAborted(signal);
		const result = await this.#readSourceChunk(sourceId, index, new Set(), signal);
		throwIfAborted(signal);
		return result;
	}

	async #readSourceChunk(sourceId, chunkIndex, ancestors, signal) {
		const source = await this.getSourceMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
		if (ancestors.has(sourceId)) throw new Error('The immutable source dependency graph contains a cycle.');
		if (chunkIndex >= nonNegativeInteger(source.chunkCount, 0)) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		const nextAncestors = new Set(ancestors).add(sourceId);
		throwIfAborted(signal);
		if (source.storage === 'copy-on-write') {
			const replacement = await this.#sourceChunkRecord(source.sourceToken, chunkIndex);
			const chunk = replacement
				? await this.#sourceChunkFromRecord(replacement, source, signal)
				: await this.#readSourceChunk(source.baseSourceId, chunkIndex, nextAncestors, signal);
			this.#queueLegacyPcmMigration(source);
			return chunk;
		}
		if (source.storage === PCM_CONTAINER_STORAGE_TYPE) {
			return this.#readPcmContainerSourceChunk(source, chunkIndex, signal);
		}
		if (source.storage === 'opfs') {
			const chunk = await this.#readLegacyOpfsSourceChunk(source, chunkIndex, signal);
			this.#queueLegacyPcmMigration(source);
			return chunk;
		}
		const record = await this.#sourceChunkRecord(source.sourceToken, chunkIndex);
		if (!record) throw new Error(`Source storage chunk ${chunkIndex} is missing.`);
		const chunk = await this.#sourceChunkFromRecord(record, source, signal);
		this.#queueLegacyPcmMigration(source);
		return chunk;
	}

	async *#readSourceChunks(sourceId, ancestors) {
		const source = await this.getSourceMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
		if (ancestors.has(sourceId)) throw new Error('The immutable source dependency graph contains a cycle.');
		const nextAncestors = new Set(ancestors).add(sourceId);
		if (source.storage === 'copy-on-write') {
			const replacementIterator = this.#sourceChunkRecords(source.sourceToken)[Symbol.asyncIterator]();
			let replacement = await replacementIterator.next();
			let migrationQueued = false;
			try {
				for await (const baseChunk of this.#readSourceChunks(source.baseSourceId, nextAncestors)) {
					if (!replacement.done && replacement.value.index < baseChunk.index) {
						throw new Error('A derived source replacement points beyond its base source.');
					}
					if (replacement.done || replacement.value.index !== baseChunk.index) {
						if (!migrationQueued) {
							migrationQueued = true;
							this.#queueLegacyPcmMigration(source);
						}
						yield baseChunk;
						continue;
					}
					const chunk = await this.#sourceChunkFromRecord(replacement.value, source);
					if (!migrationQueued) {
						migrationQueued = true;
						this.#queueLegacyPcmMigration(source);
					}
					yield chunk;
					replacement = await replacementIterator.next();
				}
				if (!replacement.done) throw new Error('A derived source replacement points beyond its base source.');
			} finally {
				await replacementIterator.return?.();
			}
			return;
		}
		if (source.storage === PCM_CONTAINER_STORAGE_TYPE) {
			yield* this.#readPcmContainerSourceChunks(source);
			return;
		}
		if (source.storage === 'opfs') {
			let migrationQueued = false;
			for await (const chunk of this.#readLegacyOpfsSourceChunks(source)) {
				if (!migrationQueued) {
					migrationQueued = true;
					this.#queueLegacyPcmMigration(source);
				}
				yield chunk;
			}
			return;
		}
		let migrationQueued = false;
		for await (const record of this.#sourceChunkRecords(source.sourceToken)) {
			const chunk = await this.#sourceChunkFromRecord(record, source);
			if (!migrationQueued) {
				migrationQueued = true;
				this.#queueLegacyPcmMigration(source);
			}
			yield chunk;
		}
	}

	/** Rehydrate a persisted source directly into its destination AudioBuffer. */
	async loadSourceAudioBuffer(sourceId, audioContext) {
		if (!audioContext?.createBuffer) throw new TypeError('An AudioContext is required to load a source.');
		const source = await this.getSourceMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
		const frameCount = nonNegativeInteger(source.frameCount ?? source.frameLength, 0);
		const channelCount = nonNegativeInteger(source.channelCount, 0);
		if (!frameCount || !channelCount) throw new Error('The stored audio source metadata is invalid.');
		const buffer = audioContext.createBuffer(channelCount, frameCount, source.sampleRate || 48000);
		let offset = 0;
		for await (const chunk of this.readSourceChunks(sourceId)) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				if (!chunk.channels[channel]) throw new Error('A stored audio source channel is missing.');
				if (typeof buffer.copyToChannel === 'function') buffer.copyToChannel(chunk.channels[channel], channel, offset);
				else buffer.getChannelData(channel).set(chunk.channels[channel], offset);
			}
			offset += chunk.frames;
		}
		if (offset !== frameCount) throw new Error('The stored audio source frame count does not match its metadata.');
		return buffer;
	}

	async deleteSource(sourceId) {
		await this.#cancelLegacyPcmMigration(sourceId);
		const source = await this.getSourceMetadata(sourceId);
		if (source) {
			const dependent = (await this.listSources()).find((candidate) => candidate.baseSourceId === sourceId);
			if (dependent) throw new Error(`Source ${sourceId} is retained by derived source ${dependent.id}.`);
			const database = await this.#database();
			if (!database) this.memory.sources.delete(sourceId);
			else await transact(database, 'sources', 'readwrite', ({ sources }) => { sources.delete(sourceId); });
			await this.#deleteStoredSource(source);
		}
		await this.deleteMediaAsset(sourceId);
		await this.deleteAnalysis(`audio-editor-peaks-v1:${sourceId}`);
	}

	/**
	 * Delete immutable source data that no live or durable snapshot can reach.
	 * Durable roots and deletions share one IndexedDB transaction, preventing a
	 * concurrent autosave from racing the reachability check. Callers pass
	 * unsaved undo/redo snapshots and other live-only roots explicitly.
	 */
	pruneUnreferencedSources(options = {}) {
		const operation = this.sourcePrunePromise.then(() => this.#pruneUnreferencedSources(options));
		this.sourcePrunePromise = operation.catch(() => undefined);
		return operation;
	}

	/** Remove only old, uncommitted chunks/files so active tabs keep their writes. */
	async cleanupTemporaryAssets({ maximumAgeMs = 24 * 60 * 60 * 1000 } = {}) {
		const sources = await this.listSources();
		const tokens = new Set(sources.map((source) => source.sourceToken).filter(Boolean));
		const binaryRecords = [
			...await this.#mediaAssetRecords(),
			...await this.#allVideoDerivativeRecords(),
		];
		const paths = new Set([
			...sources.map((source) => source.path),
			...binaryRecords.map((record) => record.path),
		].filter(Boolean));
		const cutoff = Date.now() - maximumAgeMs;
		const database = await this.#database();
		if (!database) {
			for (const [key, chunk] of this.memory.sourceChunks) {
				if (!tokens.has(chunk.sourceToken) && Number(chunk.createdAt) < cutoff) this.memory.sourceChunks.delete(key);
			}
		} else {
			let afterPrimaryKey;
			while (true) {
				const chunks = await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => {
					return readCursorPage(sourceChunks, { afterPrimaryKey, limit: SOURCE_CHUNK_CURSOR_PAGE_SIZE });
				});
				if (!chunks.length) break;
				afterPrimaryKey = chunks.at(-1).key;
				const staleKeys = chunks
					.filter((chunk) => !tokens.has(chunk.sourceToken) && Number(chunk.createdAt) < cutoff)
					.map((chunk) => chunk.key);
				if (staleKeys.length) await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => {
					for (const key of staleKeys) sourceChunks.delete(key);
				});
			}
		}

		const directory = await this.#opfsDirectory();
		if (!directory?.entries) return;
		for await (const [name, handle] of directory.entries()) {
			if (paths.has(name) || handle.kind !== 'file') continue;
			try {
				const file = await handle.getFile();
				if (file.lastModified < cutoff) {
					this.pcmContainerIndexCache.delete(name);
					await directory.removeEntry(name);
				}
			} catch { /* A concurrently removed file needs no cleanup. */ }
		}
	}

	async estimateStorage() {
		if (!this.storageManager?.estimate) return { usage: null, quota: null };
		try {
			const result = await this.storageManager.estimate();
			return { usage: result.usage ?? null, quota: result.quota ?? null };
		} catch {
			return { usage: null, quota: null };
		}
	}

	async requestPersistentStorage() {
		if (!this.storageManager?.persist) return false;
		try {
			return Boolean(await this.storageManager.persist());
		} catch {
			return false;
		}
	}

	async clear() {
		await this.#stopPcmBackgroundWork();
		const opfsRecords = [];
		const database = await this.#database();
		if (!database) {
				opfsRecords.push(
					...[...this.memory.sources.values()].filter((source) => isOpfsPcmStorage(source.storage)),
				...[...this.memory.mediaAssets.values()].filter((record) => record.storage === 'opfs'),
				...[...this.memory.videoDerivatives.values()].filter((record) => record.storage === 'opfs'),
			);
			for (const value of Object.values(this.memory)) value.clear();
		} else {
			opfsRecords.push(
				...await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.getAll())),
				...await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.getAll())),
				...await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => request(videoDerivatives.getAll())),
			);
			await transact(database, [
				'projects',
				'revisions',
				'settings',
				'analysis',
				'sources',
				'sourceChunks',
				'mediaAssets',
				'videoDerivatives',
			], 'readwrite', (stores) => {
				for (const store of Object.values(stores)) store.clear();
			});
		}
		for (const record of opfsRecords) {
			if (record.sourceToken) await this.#deleteStoredSource(record);
			else await this.#deleteBinaryRecords([record]);
		}
	}

	async close() {
		await this.#stopPcmBackgroundWork({ closeCodec: true });
		const database = this.databasePromise
			? await this.databasePromise.catch(() => null)
			: null;
		database?.close();
		this.databasePromise = null;
	}

	async #putKeyValue(storeName, key, value) {
		const database = await this.#database();
		const record = { key, value: clone(value) };
		if (!database) this.memory[storeName].set(key, record);
		else await transact(database, storeName, 'readwrite', (stores) => { stores[storeName].put(record); });
		return clone(value);
	}

	async #pruneUnreferencedSources({
		protectedProjects = [],
		protectedSourceIds = [],
		minimumAgeMs = 60_000,
		now = Date.now(),
	} = {}) {
		const migrationsToResume = [...this.legacyMigrationPromises.keys()];
		await this.#stopPcmBackgroundWork({ clearFailures: false });
		const protectedIds = new Set(protectedSourceIds || []);
		for (const project of protectedProjects || []) collectProjectSourceIds(project, protectedIds);
		const maximumAge = Math.max(0, Number(minimumAgeMs) || 0);
		const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
		const deletedSources = [];
		const deletedBinaryRecords = [];
		const deletedSourceIds = [];
		const deferredSourceIds = [];
		let nextEligibleAt = null;
		const database = await this.#database();

		if (!database) {
			for (const [id, project] of this.memory.projects) {
				const compacted = compactProjectSourceMetadata(project);
				if (compacted !== project) this.memory.projects.set(id, compacted);
				collectProjectSourceIds(compacted, protectedIds);
			}
			for (const [key, record] of this.memory.revisions) {
				const compacted = compactProjectSourceMetadata(record.project);
				if (compacted !== record.project) this.memory.revisions.set(key, { ...record, project: compacted });
				collectProjectSourceIds(compacted, protectedIds);
			}
			protectSourceDependencies(protectedIds, [...this.memory.sources.values()]);
			const candidates = sourceStorageCandidates(
				[...this.memory.sources.values()],
				[...this.memory.mediaAssets.values()],
				[...this.memory.videoDerivatives.values()],
			);
			for (const [sourceId, candidate] of candidates) {
				if (protectedIds.has(sourceId)) continue;
				const eligibleAt = candidateEligibleAt(candidate, maximumAge);
				if (eligibleAt > currentTime) {
					deferredSourceIds.push(sourceId);
					nextEligibleAt = nextEligibleAt === null ? eligibleAt : Math.min(nextEligibleAt, eligibleAt);
					continue;
				}
				deletedSourceIds.push(sourceId);
				if (candidate.source) deletedSources.push(candidate.source);
				if (candidate.mediaAsset) deletedBinaryRecords.push(candidate.mediaAsset);
				deletedBinaryRecords.push(...candidate.derivatives);
				this.memory.sources.delete(sourceId);
				this.memory.mediaAssets.delete(sourceId);
				for (const derivative of candidate.derivatives) this.memory.videoDerivatives.delete(derivative.key);
				this.memory.analysis.delete(`audio-editor-peaks-v1:${sourceId}`);
				for (const [key, chunk] of this.memory.sourceChunks) {
					if (candidate.source?.sourceToken && chunk.sourceToken === candidate.source.sourceToken) {
						this.memory.sourceChunks.delete(key);
					}
				}
			}
		} else {
			const result = await transact(
				database,
				[
					'projects',
					'revisions',
					'analysis',
					'sources',
					'sourceChunks',
					'mediaAssets',
					'videoDerivatives',
				],
				'readwrite',
				async ({
					projects,
					revisions,
					analysis,
					sources,
					sourceChunks,
					mediaAssets,
					videoDerivatives,
				}) => {
					const savedProjects = await request(projects.getAll());
					const savedRevisions = await request(revisions.getAll());
					for (const saved of savedProjects) {
						const compacted = compactProjectSourceMetadata(saved);
						if (compacted !== saved) projects.put(compacted);
						collectProjectSourceIds(compacted, protectedIds);
					}
					for (const record of savedRevisions) {
						const compacted = compactProjectSourceMetadata(record.project);
						if (compacted !== record.project) revisions.put({ ...record, project: compacted });
						collectProjectSourceIds(compacted, protectedIds);
					}

					const storedSources = await request(sources.getAll());
					const storedMediaAssets = await request(mediaAssets.getAll());
					const storedVideoDerivatives = await request(videoDerivatives.getAll());
					protectSourceDependencies(protectedIds, storedSources);
					const candidates = sourceStorageCandidates(storedSources, storedMediaAssets, storedVideoDerivatives);
					const removedSources = [];
					const removedBinaryRecords = [];
					const removedSourceIds = [];
					for (const [sourceId, candidate] of candidates) {
						if (protectedIds.has(sourceId)) continue;
						const eligibleAt = candidateEligibleAt(candidate, maximumAge);
						if (eligibleAt > currentTime) {
							deferredSourceIds.push(sourceId);
							nextEligibleAt = nextEligibleAt === null ? eligibleAt : Math.min(nextEligibleAt, eligibleAt);
							continue;
						}
						removedSourceIds.push(sourceId);
						if (candidate.source) {
							removedSources.push(candidate.source);
							sources.delete(sourceId);
							if (candidate.source.sourceToken) {
								await deleteByIndex(sourceChunks.index('sourceToken'), candidate.source.sourceToken);
							}
						}
						if (candidate.mediaAsset) {
							removedBinaryRecords.push(candidate.mediaAsset);
							mediaAssets.delete(sourceId);
						}
						for (const derivative of candidate.derivatives) {
							removedBinaryRecords.push(derivative);
							videoDerivatives.delete(derivative.key);
						}
						analysis.delete(`audio-editor-peaks-v1:${sourceId}`);
					}
					return { removedSources, removedBinaryRecords, removedSourceIds };
				},
			);
			deletedSources.push(...result.removedSources);
			deletedBinaryRecords.push(...result.removedBinaryRecords);
			deletedSourceIds.push(...result.removedSourceIds);
		}

		for (const source of deletedSources) {
			if (isOpfsPcmStorage(source.storage)) await this.#deleteStoredSource(source);
		}
		await this.#deleteBinaryRecords(deletedBinaryRecords);
		const deletedSourceIdSet = new Set(deletedSourceIds);
		for (const sourceId of deletedSourceIdSet) this.legacyMigrationFailures.delete(sourceId);
		for (const sourceId of migrationsToResume) {
			if (deletedSourceIdSet.has(sourceId)) continue;
			const source = await this.getSourceMetadata(sourceId);
			if (source) this.#queueLegacyPcmMigration(source);
		}
		return {
			deletedSourceIds,
			deferredSourceIds,
			retainedSourceIds: [...protectedIds],
			nextEligibleAt,
		};
	}

	async #pruneProjectRevisions(projectId) {
		const database = await this.#database();
		if (!database) {
			const records = [...this.memory.revisions.values()]
				.filter((record) => record.projectId === projectId)
				.sort((left, right) => right.revision - left.revision);
			for (const record of records.slice(this.revisionLimit)) this.memory.revisions.delete(record.key);
			return;
		}
		const records = await transact(database, 'revisions', 'readonly', ({ revisions }) => request(revisions.index('projectId').getAll(projectId)));
		records.sort((left, right) => right.revision - left.revision);
		if (records.length <= this.revisionLimit) return;
		await transact(database, 'revisions', 'readwrite', ({ revisions }) => {
			for (const record of records.slice(this.revisionLimit)) revisions.delete(record.key);
		});
	}

	async #getKeyValue(storeName, key) {
		const database = await this.#database();
		const record = !database
			? this.memory[storeName].get(key)
			: await transact(database, storeName, 'readonly', (stores) => request(stores[storeName].get(key)));
		return record ? clone(record.value) : undefined;
	}

	async #mediaAssetRecord(sourceId) {
		const database = await this.#database();
		const record = !database
			? this.memory.mediaAssets.get(sourceId)
			: await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(sourceId)));
		return record ? clone(record) : null;
	}

	async #mediaAssetRecords() {
		const database = await this.#database();
		const records = !database
			? [...this.memory.mediaAssets.values()]
			: await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.getAll()));
		return records.map(clone);
	}

	async #videoDerivativeRecord(key) {
		const database = await this.#database();
		const record = !database
			? this.memory.videoDerivatives.get(key)
			: await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => request(videoDerivatives.get(key)));
		return record ? clone(record) : null;
	}

	async #videoDerivativeRecords(sourceId) {
		const database = await this.#database();
		const records = !database
			? [...this.memory.videoDerivatives.values()].filter((record) => record.sourceId === sourceId)
			: await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => {
				return request(videoDerivatives.index('sourceId').getAll(sourceId));
			});
		return records.map(clone);
	}

	async #allVideoDerivativeRecords() {
		const database = await this.#database();
		const records = !database
			? [...this.memory.videoDerivatives.values()]
			: await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => request(videoDerivatives.getAll()));
		return records.map(clone);
	}

	async #loadBinaryRecord(record, missingMessage) {
		if (record.storage !== 'opfs') {
			if (!record.blob) throw new Error(missingMessage);
			return blobWithMimeType(record.blob, record.mimeType);
		}
		const directory = await this.#opfsDirectory();
		try {
			const handle = await directory?.getFileHandle(record.path);
			if (!handle) throw new Error(missingMessage);
			return blobWithMimeType(await handle.getFile(), record.mimeType);
		} catch {
			throw new Error(missingMessage);
		}
	}

	async #writeOpfsBlob(prefix, blob) {
		const directory = await this.#opfsDirectory();
		if (!directory?.getFileHandle) return null;
		const stem = String(prefix || 'media').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80);
		const path = `${stem}-${createId('asset').replace(/[^a-z0-9._-]+/gi, '-')}.blob`;
		let writable;
		try {
			const handle = await directory.getFileHandle(path, { create: true });
			writable = await handle.createWritable();
			await writable.write(blob);
			await writable.close();
			return { path };
		} catch {
			try {
				if (typeof writable?.abort === 'function') await writable.abort();
			} catch { /* A failed OPFS write may already be closed. */ }
			await this.#deleteOpfsPath(path);
			return null;
		}
	}

	async #deleteBinaryRecords(records) {
		for (const record of records || []) {
			if (record?.storage === 'opfs' && record.path) await this.#deleteOpfsPath(record.path);
		}
	}

	async #deleteOpfsPath(path) {
		if (!path) return;
		this.pcmContainerIndexCache.delete(path);
		const directory = await this.#opfsDirectory();
		try { await directory?.removeEntry(path); } catch { /* Missing and orphaned files are harmless. */ }
	}

	#pcmCodecInstance() {
		if (!this.pcmCodec) this.pcmCodec = this.pcmCodecFactory();
		if (!this.pcmCodec?.encode || !this.pcmCodec?.decode) {
			throw new TypeError('pcmCodec must provide encode() and decode() methods.');
		}
		return this.pcmCodec;
	}

	async #encodePcmPayload(rawInput, {
		frames,
		channelCount,
		sampleRate,
		priority,
		signal,
		allowRawOnFailure,
	} = {}) {
		const rawPayload = exactArrayBuffer(rawInput);
		const rawBytes = pcmRawByteLength(frames, channelCount);
		if (rawPayload.byteLength !== rawBytes) {
			throw new RangeError('Raw PCM payload does not match its declared geometry.');
		}
		const pcmCrc32 = crc32(rawPayload);
		const rawResult = () => ({
			encoding: PCM_ENCODING_RAW_F32LE,
			payload: rawPayload,
			pcmCrc32,
			uncompressedBytes: rawBytes,
			storedBytes: rawBytes,
		});
		if (rawBytes <= minimumWavPackSavings(rawBytes)) return rawResult();
		if (this.pcmCodecCircuitOpen) {
			if (allowRawOnFailure) return rawResult();
			throw new Error('WavPack encoding is disabled for this session after a codec failure.');
		}
		try {
			const codecInput = rawPayload.slice(0);
			const encoded = await this.#pcmCodecInstance().encode(codecInput, {
				frames,
				channelCount,
				sampleRate,
				priority,
				signal,
				transferInput: true,
			});
			const encoding = encoded?.encoding;
			const payload = exactArrayBuffer(encoded?.payload);
			const resultCrc32 = Number(encoded?.pcmCrc32 ?? pcmCrc32) >>> 0;
			if (resultCrc32 !== pcmCrc32) throw new Error('PCM codec returned an unexpected source CRC-32.');
			if (encoding === PCM_ENCODING_WAVPACK_F32_V1) {
				const minimumSavings = minimumWavPackSavings(rawBytes);
				if (!payload.byteLength
					|| payload.byteLength > rawBytes - minimumSavings) {
					return rawResult();
				}
				return {
					encoding,
					payload,
					pcmCrc32,
					uncompressedBytes: rawBytes,
					storedBytes: payload.byteLength,
				};
			}
			if (encoding === PCM_ENCODING_RAW_F32LE) {
				if (payload.byteLength !== rawBytes || crc32(payload) !== pcmCrc32) {
					throw new Error('PCM codec returned invalid raw fallback data.');
				}
				return {
					encoding,
					payload,
					pcmCrc32,
					uncompressedBytes: rawBytes,
					storedBytes: rawBytes,
				};
			}
			throw new Error(`PCM codec returned unsupported encoding ${String(encoding)}.`);
		} catch (error) {
			if (error?.name === 'AbortError') throw error;
			this.pcmCodecCircuitOpen = true;
			if (allowRawOnFailure) return rawResult();
			throw error;
		}
	}

	async #writeSourceChunk(record) {
		const database = await this.#database();
		if (!database) this.memory.sourceChunks.set(record.key, cloneChunk(record));
		else await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => { sourceChunks.put(record); });
	}

	async *#sourceChunkRecords(token) {
		const database = await this.#database();
		if (!database) {
			const records = [...this.memory.sourceChunks.values()]
				.filter((record) => record.sourceToken === token)
				.sort((left, right) => left.index - right.index);
			for (const record of records) yield cloneChunk(record);
			return;
		}
		let afterPrimaryKey;
		while (true) {
			const records = await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => {
				return readCursorPage(sourceChunks.index('sourceToken'), {
					query: token,
					afterPrimaryKey,
					limit: SOURCE_CHUNK_CURSOR_PAGE_SIZE,
				});
			});
			if (!records.length) return;
			afterPrimaryKey = records.at(-1).key;
			for (const record of records) yield record;
		}
	}

	async #sourceChunkRecord(token, index) {
		const key = `${token}:${String(index).padStart(10, '0')}`;
		const database = await this.#database();
		const record = !database
			? this.memory.sourceChunks.get(key)
			: await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => request(sourceChunks.get(key)));
		return record ? cloneChunk(record) : null;
	}

	async #putSourceMetadata(record) {
		const database = await this.#database();
		if (!database) this.memory.sources.set(record.id, clone(record));
		else await transact(database, 'sources', 'readwrite', ({ sources }) => { sources.put(record); });
	}

	async #deleteSourceChunks(token) {
		if (!token) return;
		const database = await this.#database();
		if (!database) {
			for (const [key, record] of this.memory.sourceChunks) {
				if (record.sourceToken === token) this.memory.sourceChunks.delete(key);
			}
			return;
		}
		await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => deleteByIndex(sourceChunks.index('sourceToken'), token));
	}

	async #deleteStoredSource(source) {
		if (isOpfsPcmStorage(source?.storage) && source.path) {
			this.pcmContainerIndexCache.delete(source.path);
			const directory = await this.#opfsDirectory();
			try { await directory?.removeEntry(source.path); } catch { /* Missing and orphaned files are harmless. */ }
			return;
		}
		if (source?.sourceToken) await this.#deleteSourceChunks(source.sourceToken);
	}

	async #createOpfsWriter(token, metadata = {}) {
		const directory = await this.#opfsDirectory();
		if (!directory?.getFileHandle) return null;
		const store = this;
		const path = `${token.replace(/[^a-z0-9._-]+/gi, '-')}${PCM_CONTAINER_EXTENSION}`;
		try {
			const handle = await directory.getFileHandle(path, { create: true });
			const writable = await handle.createWritable();
			let container = null;
			let closed = false;
			return {
				path,
				async write(chunk) {
					if (closed) throw new Error('The OPFS source writer is closed.');
					if (!container) {
						container = new PcmContainerWriter(writable, {
							channelCount: chunk.channelCount,
							sampleRate: chunk.sampleRate ?? metadata.sampleRate ?? 48_000,
							chunkFrames: chunk.chunkFrames ?? metadata.chunkFrames ?? chunk.frames,
						});
					}
					await container.write(chunk);
				},
				async close() {
					if (closed) return container?.statistics() || compressionStatistics();
					closed = true;
					if (container) return container.close();
					await writable.close();
					return compressionStatistics();
				},
				async remove() {
					store.pcmContainerIndexCache.delete(path);
					try { await directory.removeEntry(path); } catch { /* Already absent. */ }
				},
				async abort() {
					if (!closed) {
						closed = true;
						if (typeof writable.abort === 'function') await writable.abort();
						else await writable.close();
					}
					store.pcmContainerIndexCache.delete(path);
					try { await directory.removeEntry(path); } catch { /* Already absent. */ }
				},
			};
		} catch {
			try { await directory.removeEntry(path); } catch { /* Creation may not have reached disk. */ }
			return null;
		}
	}

	async *#readPcmContainerSourceChunks(source, { priority = 'foreground', signal } = {}) {
		const file = await this.#opfsSourceFile(source);
		const index = await this.#pcmContainerIndex(source, file);
		for (const entry of index.entries) {
			throwIfAborted(signal);
			const payload = await readPcmContainerPayload(file, entry, { signal });
			yield this.#pcmContainerChunk(source, entry, payload, { signal, priority });
		}
	}

	async #readPcmContainerSourceChunk(source, chunkIndex, signal, priority = 'foreground') {
		const file = await this.#opfsSourceFile(source);
		const index = await this.#pcmContainerIndex(source, file);
		const entry = index.entries[chunkIndex];
		if (!entry) throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		const payload = await readPcmContainerPayload(file, entry, { signal });
		return this.#pcmContainerChunk(source, entry, payload, { signal, priority });
	}

	async #pcmContainerChunk(source, entry, payload, { signal, priority }) {
		return this.#sourceChunkFromRecord({
			index: entry.index,
			frames: entry.frames,
			encoding: containerCodecToEncoding(entry.codec),
			payload,
			pcmCrc32: entry.pcmCrc32,
		}, source, signal, priority);
	}

	async #pcmContainerIndex(source, file) {
		let cached = this.pcmContainerIndexCache.get(source.path);
		if (!cached) {
			cached = parsePcmContainerIndex(file, {
				expectedChannelCount: source.channelCount,
				expectedSampleRate: source.sampleRate,
				expectedChunkFrames: source.chunkFrames,
				expectedChunkCount: source.chunkCount,
				expectedFrameCount: source.frameCount ?? source.frameLength,
			});
			this.pcmContainerIndexCache.set(source.path, cached);
			cached.catch(() => {
				if (this.pcmContainerIndexCache.get(source.path) === cached) {
					this.pcmContainerIndexCache.delete(source.path);
				}
			});
		}
		return cached;
	}

	async #opfsSourceFile(source) {
		const directory = await this.#opfsDirectory();
		if (!directory) throw new Error('Origin-private audio storage is unavailable.');
		try {
			const handle = await directory.getFileHandle(source.path);
			return await handle.getFile();
		} catch {
			throw new Error('The requested local audio source is missing.');
		}
	}

	async *#readLegacyOpfsSourceChunks(source) {
		const file = await this.#opfsSourceFile(source);
		let offset = 0;
		let index = 0;
		while (offset < file.size) {
			if (file.size - offset < 8) throw new Error('The local audio source is truncated.');
			const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
			const frames = header.getUint32(0, true);
			const channelCount = header.getUint16(4, true);
			offset += 8;
			const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
			if (!frames || !channelCount || offset + channelBytes * channelCount > file.size) {
				throw new Error('The local audio source contains an invalid chunk.');
			}
			const channels = [];
			for (let channel = 0; channel < channelCount; channel += 1) {
				channels.push(new Float32Array(await file.slice(offset, offset + channelBytes).arrayBuffer()));
				offset += channelBytes;
			}
			yield { index, frames, channels };
			index += 1;
		}
	}

	async #readLegacyOpfsSourceChunk(source, chunkIndex, signal) {
		const chunkFrames = nonNegativeInteger(source.chunkFrames, 0);
		const channelCount = nonNegativeInteger(source.channelCount, 0);
		if (!chunkFrames || !channelCount) {
			for await (const chunk of this.#readLegacyOpfsSourceChunks(source)) {
				throwIfAborted(signal);
				if (chunk.index === chunkIndex) return chunk;
			}
			throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		}
		const file = await this.#opfsSourceFile(source);
		throwIfAborted(signal);
		const fullChunkBytes = 8 + chunkFrames * channelCount * Float32Array.BYTES_PER_ELEMENT;
		let offset = chunkIndex * fullChunkBytes;
		if (file.size - offset < 8) throw new Error('The local audio source is truncated.');
		const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
		const frames = header.getUint32(0, true);
		const storedChannelCount = header.getUint16(4, true);
		if (!frames || frames > chunkFrames || storedChannelCount !== channelCount) {
			throw new Error('The local audio source contains an invalid chunk.');
		}
		offset += 8;
		const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
		if (offset + channelBytes * channelCount > file.size) throw new Error('The local audio source is truncated.');
		const channels = [];
		for (let channel = 0; channel < channelCount; channel += 1) {
			throwIfAborted(signal);
			channels.push(new Float32Array(await file.slice(offset, offset + channelBytes).arrayBuffer()));
			offset += channelBytes;
		}
		return { index: chunkIndex, frames, channels };
	}

	async #sourceChunkFromRecord(record, source, signal, priority = 'foreground') {
		throwIfAborted(signal);
		if (Array.isArray(record?.channels)) return sourceChunkFromLegacyRecord(record);
		let frames;
		let channelCount;
		let rawBytes;
		let payload;
		let expectedCrc32;
		try {
			frames = Number(record?.frames);
			channelCount = Number(source?.channelCount);
			rawBytes = pcmRawByteLength(frames, channelCount);
			payload = exactArrayBuffer(record?.payload);
			expectedCrc32 = Number(record?.pcmCrc32);
			if (!Number.isSafeInteger(expectedCrc32)
				|| expectedCrc32 < 0
				|| expectedCrc32 > 0xffffffff) {
				throw new RangeError('PCM CRC-32 is outside its unsigned 32-bit range.');
			}
		} catch (error) {
			throw new PcmStorageCorruptionError(
				'Persisted PCM record has invalid geometry.',
				'PCM_RECORD_GEOMETRY',
				{ cause: error },
			);
		}
		let rawPayload;
		if (record.encoding === PCM_ENCODING_RAW_F32LE) {
			if (payload.byteLength !== rawBytes) {
				throw new PcmStorageCorruptionError(
					'Raw persisted PCM has invalid geometry.',
					'PCM_RECORD_GEOMETRY',
				);
			}
			rawPayload = payload;
			if (crc32(rawPayload) !== expectedCrc32) {
				throw new PcmStorageCorruptionError(
					'Raw persisted PCM failed its CRC-32.',
					'PCM_CRC_MISMATCH',
				);
			}
		} else if (record.encoding === PCM_ENCODING_WAVPACK_F32_V1) {
			if (!payload.byteLength || payload.byteLength > rawBytes) {
				throw new PcmStorageCorruptionError(
					'Persisted WavPack PCM has invalid bounded geometry.',
					'PCM_RECORD_GEOMETRY',
				);
			}
			try {
				const decoded = await this.#pcmCodecInstance().decode(payload, {
					encoding: record.encoding,
					frames,
					channelCount,
					sampleRate: source.sampleRate || 48_000,
					pcmCrc32: expectedCrc32,
					priority,
					signal,
					transferInput: true,
				});
				rawPayload = exactArrayBuffer(decoded?.payload);
			} catch (error) {
				if (error?.name === 'AbortError') throw error;
				throw new PcmStorageCorruptionError(
					'Persisted WavPack PCM could not be decoded losslessly.',
					error?.code || 'PCM_WAVPACK_DECODE',
					{ cause: error },
				);
			}
			if (rawPayload.byteLength !== rawBytes || crc32(rawPayload) !== expectedCrc32) {
				throw new PcmStorageCorruptionError(
					'Decoded WavPack PCM failed its geometry or CRC-32.',
					'PCM_CRC_MISMATCH',
				);
			}
		} else {
			throw new PcmStorageCorruptionError(
				`Persisted PCM uses unsupported encoding ${String(record.encoding)}.`,
				'PCM_RECORD_ENCODING',
			);
		}
		throwIfAborted(signal);
		return {
			index: record.index,
			frames,
			channels: unpackPlanarFloat32(rawPayload, frames, channelCount),
		};
	}

	#queueLegacyPcmMigration(source) {
		if (!this.migrateLegacyPcmOnAccess
			|| !sourceNeedsLegacyPcmMigration(source)
			|| (this.backend === 'memory' && source.storage !== 'opfs')
			|| this.legacyMigrationFailures.has(source.id)
			|| this.legacyMigrationPromises.has(source.id)) {
			return;
		}
		const controller = new AbortController();
		this.legacyMigrationControllers.set(source.id, controller);
		const promise = new Promise((resolve) => setTimeout(resolve, 0))
			.then(async () => {
				throwIfAborted(controller.signal);
				await this.#migrateLegacyPcmSource(clone(source), controller.signal);
			})
			.catch((error) => {
				if (error?.name !== 'AbortError') this.legacyMigrationFailures.add(source.id);
			})
			.finally(() => {
				if (this.legacyMigrationPromises.get(source.id) === promise) {
					this.legacyMigrationPromises.delete(source.id);
					this.legacyMigrationControllers.delete(source.id);
				}
			});
		this.legacyMigrationPromises.set(source.id, promise);
	}

	async #migrateLegacyPcmSource(source, signal) {
		const current = await this.getSourceMetadata(source.id);
		if (!sameStoredSourceIdentity(current, source)
			|| !sourceNeedsLegacyPcmMigration(current)) return;
		if (source.storage === 'opfs') {
			await this.#migrateLegacyOpfsSource(source, signal);
			return;
		}
		if (source.storage === 'indexeddb-chunks'
			|| source.storage === 'copy-on-write') {
			await this.#migrateLegacyIndexedDbSource(source, signal);
		}
	}

	async #migrateLegacyOpfsSource(source, signal) {
		const channelCount = positiveInteger(source.channelCount, 0);
		const frameCount = positiveInteger(source.frameCount ?? source.frameLength, 0);
		const chunkFrames = positiveInteger(source.chunkFrames, 0);
		const chunkCount = positiveInteger(source.chunkCount, 0);
		if (!channelCount || !frameCount || !chunkFrames || !chunkCount) {
			throw new PcmStorageCorruptionError(
				'Legacy OPFS source metadata is incomplete.',
				'PCM_MIGRATION_GEOMETRY',
			);
		}
		await this.#requireLegacyOpfsMigrationHeadroom({
			frameCount,
			channelCount,
			chunkCount,
		});
		throwIfAborted(signal);
		const token = `${source.id}:migration:${createId('write')}`;
		const writer = await this.#createOpfsWriter(token, source);
		if (!writer) throw new Error('Origin-private audio storage is unavailable for PCM migration.');
		let published = false;
		try {
			let index = 0;
			let migratedFrames = 0;
			for await (const chunk of this.#readLegacyOpfsSourceChunks(source)) {
				throwIfAborted(signal);
				if (chunk.index !== index
					|| chunk.channels.length !== channelCount
					|| chunk.frames > chunkFrames) {
					throw new PcmStorageCorruptionError(
						'Legacy OPFS source contains invalid chunk geometry.',
						'PCM_MIGRATION_GEOMETRY',
					);
				}
				const stored = await this.#encodePcmPayload(packPlanarFloat32(chunk.channels), {
					frames: chunk.frames,
					channelCount,
					sampleRate: source.sampleRate || 48_000,
					priority: 'migration',
					signal,
					allowRawOnFailure: false,
				});
				await writer.write({
					...stored,
					frames: chunk.frames,
					channelCount,
					sampleRate: source.sampleRate || 48_000,
					chunkFrames,
				});
				index += 1;
				migratedFrames += chunk.frames;
				await yieldMigration(signal);
			}
			if (index !== chunkCount || migratedFrames !== frameCount) {
				throw new PcmStorageCorruptionError(
					'Legacy OPFS source does not match its chunk or frame count.',
					'PCM_MIGRATION_GEOMETRY',
				);
			}
			const statistics = await writer.close();
			const replacement = {
				...source,
				storage: PCM_CONTAINER_STORAGE_TYPE,
				sourceToken: token,
				path: writer.path,
				pcmEncodingVersion: 1,
				...statistics,
				migratedAt: new Date().toISOString(),
			};
			this.pcmContainerIndexCache.delete(writer.path);
			let verifiedChunks = 0;
			let verifiedFrames = 0;
			for await (const chunk of this.#readPcmContainerSourceChunks(replacement, {
				priority: 'migration',
				signal,
			})) {
				verifiedChunks += 1;
				verifiedFrames += chunk.frames;
				await yieldMigration(signal);
			}
			if (verifiedChunks !== chunkCount || verifiedFrames !== frameCount) {
				throw new PcmStorageCorruptionError(
					'Migrated OPFS source failed complete verification.',
					'PCM_MIGRATION_VERIFY',
				);
			}
			throwIfAborted(signal);
			published = await this.#compareAndSwapSourceMetadata(source, replacement);
			if (!published) throw new Error('PCM migration lost a source metadata compare-and-swap race.');
			await this.#deleteOpfsPath(source.path);
		} finally {
			if (!published) {
				this.pcmContainerIndexCache.delete(writer.path);
				await writer.abort().catch(() => undefined);
			}
		}
	}

	async #migrateLegacyIndexedDbSource(source, signal) {
		const database = await this.#database();
		if (!database) throw new Error('IndexedDB is unavailable for PCM migration.');
		const channelCount = positiveInteger(source.channelCount, 0);
		const expectedRecords = source.storage === 'copy-on-write'
			? nonNegativeInteger(source.overrideChunkCount, -1)
			: nonNegativeInteger(source.chunkCount, -1);
		if (!channelCount || expectedRecords < 0) {
			throw new PcmStorageCorruptionError(
				'Legacy IndexedDB source metadata is incomplete.',
				'PCM_MIGRATION_GEOMETRY',
			);
		}
		let recordCount = 0;
		let uncompressedBytes = 0;
		let storedBytes = 0;
		let wavpackChunkCount = 0;
		let rawChunkCount = 0;
		for await (const storedRecord of this.#sourceChunkRecords(source.sourceToken)) {
			throwIfAborted(signal);
			let record = storedRecord;
			if (Array.isArray(record.channels)) {
				const legacyChunk = sourceChunkFromLegacyRecord(record);
				if (legacyChunk.channels.length !== channelCount) {
					throw new PcmStorageCorruptionError(
						'Legacy IndexedDB source has an invalid channel count.',
						'PCM_MIGRATION_GEOMETRY',
					);
				}
				const encoded = await this.#encodePcmPayload(packPlanarFloat32(legacyChunk.channels), {
					frames: legacyChunk.frames,
					channelCount,
					sampleRate: source.sampleRate || 48_000,
					priority: 'migration',
					signal,
					allowRawOnFailure: false,
				});
				const { channels: _legacyChannels, ...preserved } = record;
				record = {
					...preserved,
					encoding: encoded.encoding,
					payload: encoded.payload,
					pcmCrc32: encoded.pcmCrc32,
				};
				await this.#sourceChunkFromRecord({
					...record,
					payload: exactArrayBuffer(record.payload).slice(0),
				}, source, signal, 'migration');
				if (!await this.#replaceSourceChunkIfCurrent(source, record)) {
					throw new Error('PCM migration lost a source-record compare-and-swap race.');
				}
			} else {
				await this.#sourceChunkFromRecord({
					...record,
					payload: exactArrayBuffer(record.payload).slice(0),
				}, source, signal, 'migration');
			}
			const rawBytes = pcmRawByteLength(record.frames, channelCount);
			const payloadBytes = Array.isArray(record.channels)
				? rawBytes
				: exactArrayBuffer(record.payload).byteLength;
			uncompressedBytes += rawBytes;
			storedBytes += payloadBytes;
			if (record.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
			else rawChunkCount += 1;
			recordCount += 1;
			await yieldMigration(signal);
		}
		if (recordCount !== expectedRecords) {
			throw new PcmStorageCorruptionError(
				'Legacy IndexedDB source does not match its expected record count.',
				'PCM_MIGRATION_GEOMETRY',
			);
		}
		const replacement = {
			...source,
			pcmEncodingVersion: 1,
			...compressionStatistics({
				uncompressedBytes,
				storedBytes,
				wavpackChunkCount,
				rawChunkCount,
			}),
			migratedAt: new Date().toISOString(),
		};
		throwIfAborted(signal);
		if (!await this.#compareAndSwapSourceMetadata(source, replacement)) {
			throw new Error('PCM migration lost a source metadata compare-and-swap race.');
		}
	}

	async #replaceSourceChunkIfCurrent(expectedSource, record) {
		const database = await this.#database();
		if (!database) return false;
		return transact(database, ['sources', 'sourceChunks'], 'readwrite', async ({
			sources,
			sourceChunks,
		}) => {
			const current = await request(sources.get(expectedSource.id));
			if (!sameStoredSourceIdentity(current, expectedSource)) return false;
			sourceChunks.put(record);
			return true;
		});
	}

	async #compareAndSwapSourceMetadata(expected, replacement) {
		const database = await this.#database();
		if (!database) {
			const current = this.memory.sources.get(expected.id);
			if (!sameStoredSourceIdentity(current, expected)) return false;
			this.memory.sources.set(replacement.id, clone(replacement));
			return true;
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const current = await request(sources.get(expected.id));
			if (!sameStoredSourceIdentity(current, expected)) return false;
			sources.put(replacement);
			return true;
		});
	}

	async #requireLegacyOpfsMigrationHeadroom({
		frameCount,
		channelCount,
		chunkCount,
	}) {
		const rawBytes = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
		const containerBytes = rawBytes
			+ 32
			+ chunkCount * 24
			+ 32;
		if (!Number.isSafeInteger(containerBytes)) {
			throw new RangeError('Legacy PCM migration exceeds safe browser storage bounds.');
		}
		const required = Math.ceil(containerBytes * 1.1);
		const estimate = await this.estimateStorage();
		if (Number.isFinite(estimate.usage)
			&& Number.isFinite(estimate.quota)
			&& estimate.quota - estimate.usage < required) {
			const error = new Error(`PCM migration requires ${required} bytes of temporary storage headroom.`);
			error.name = 'QuotaExceededError';
			error.code = 'PCM_MIGRATION_QUOTA';
			throw error;
		}
	}

	async #cancelLegacyPcmMigration(sourceId) {
		const id = String(sourceId);
		this.legacyMigrationControllers.get(id)?.abort();
		const promise = this.legacyMigrationPromises.get(id);
		if (promise) await promise.catch(() => undefined);
		this.legacyMigrationPromises.delete(id);
		this.legacyMigrationControllers.delete(id);
		this.legacyMigrationFailures.delete(id);
	}

	async #stopPcmBackgroundWork({ closeCodec = false, clearFailures = true } = {}) {
		for (const controller of this.legacyMigrationControllers.values()) controller.abort();
		await Promise.allSettled(this.legacyMigrationPromises.values());
		this.legacyMigrationPromises.clear();
		this.legacyMigrationControllers.clear();
		if (clearFailures) this.legacyMigrationFailures.clear();
		this.pcmContainerIndexCache.clear();
		if (closeCodec && this.ownsPcmCodec) {
			this.pcmCodec?.close?.();
			this.pcmCodec = null;
			this.pcmCodecCircuitOpen = false;
		}
	}

	async #opfsDirectory() {
		if (!this.preferOpfs) return null;
		if (!this.opfsDirectoryPromise) {
			this.opfsDirectoryPromise = (async () => {
				try {
					const root = this.opfsRoot || await this.storageManager?.getDirectory?.();
					if (!root?.getDirectoryHandle) return null;
					return root.getDirectoryHandle('audio-editor-sources', { create: true });
				} catch {
					return null;
				}
			})();
		}
		return this.opfsDirectoryPromise;
	}

	async #database() {
		if (this.backend === 'memory') return null;
		if (!this.databasePromise) {
			this.databasePromise = openDatabase(this.indexedDB, this.databaseName).catch((error) => {
				this.databasePromise = null;
				if (!this.memoryFallback) throw error;
				this.backend = 'memory';
				return null;
			});
		}
		return this.databasePromise;
	}
}

function openDatabase(indexedDB, databaseName) {
	return new Promise((resolve, reject) => {
		let openRequest;
		try {
			openRequest = indexedDB.open(databaseName, DATABASE_VERSION);
		} catch (error) {
			reject(error);
			return;
		}
		openRequest.onupgradeneeded = () => {
			const database = openRequest.result;
			if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
			if (!database.objectStoreNames.contains('revisions')) {
				const store = database.createObjectStore('revisions', { keyPath: 'key' });
				store.createIndex('projectId', 'projectId', { unique: false });
			}
			if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('analysis')) database.createObjectStore('analysis', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('sources')) database.createObjectStore('sources', { keyPath: 'id' });
			if (!database.objectStoreNames.contains('sourceChunks')) {
				const store = database.createObjectStore('sourceChunks', { keyPath: 'key' });
				store.createIndex('sourceToken', 'sourceToken', { unique: false });
			}
			if (!database.objectStoreNames.contains('mediaAssets')) {
				database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
			}
			if (!database.objectStoreNames.contains('videoDerivatives')) {
				const store = database.createObjectStore('videoDerivatives', { keyPath: 'key' });
				store.createIndex('sourceId', 'sourceId', { unique: false });
			}
		};
		openRequest.onsuccess = () => resolve(openRequest.result);
		openRequest.onerror = () => reject(openRequest.error || new Error('Could not open editor storage.'));
		openRequest.onblocked = () => reject(new Error('Editor storage is blocked by another tab.'));
	});
}

async function transact(database, storeNames, mode, operation) {
	const names = Array.isArray(storeNames) ? storeNames : [storeNames];
	const transaction = database.transaction(names, mode);
	const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
	const completion = transactionCompletion(transaction);
	let result;
	try {
		result = await operation(stores, transaction);
	} catch (error) {
		try { transaction.abort(); } catch { /* Transaction may already be inactive. */ }
		throw error;
	}
	await completion;
	return result;
}

function request(idbRequest) {
	return new Promise((resolve, reject) => {
		idbRequest.onsuccess = () => resolve(idbRequest.result);
		idbRequest.onerror = () => reject(idbRequest.error || new Error('An IndexedDB request failed.'));
	});
}

/**
 * Read a bounded cursor page. Callers open a new transaction for every page,
 * so an async iterator can pause at a yielded chunk without keeping a browser
 * transaction (and its decoded records) alive.
 */
function readCursorPage(source, { query, afterPrimaryKey, limit = SOURCE_CHUNK_CURSOR_PAGE_SIZE } = {}) {
	const maximumRecords = positiveInteger(limit, SOURCE_CHUNK_CURSOR_PAGE_SIZE);
	return new Promise((resolve, reject) => {
		const records = [];
		let cursorRequest;
		try {
			cursorRequest = query === undefined ? source.openCursor() : source.openCursor(query);
		} catch (error) {
			reject(error);
			return;
		}
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve(records);
				return;
			}
			if (afterPrimaryKey !== undefined) {
				const comparison = compareStringKeys(cursor.primaryKey, afterPrimaryKey);
				if (comparison < 0) {
					try {
						if (query !== undefined) {
							if (typeof cursor.continuePrimaryKey === 'function') cursor.continuePrimaryKey(cursor.key, afterPrimaryKey);
							else cursor.continue();
						} else {
							cursor.continue(afterPrimaryKey);
						}
					} catch (error) {
						reject(error);
					}
					return;
				}
				if (comparison === 0) {
					cursor.continue();
					return;
				}
			}
			records.push(cursor.value);
			if (records.length >= maximumRecords) {
				resolve(records);
				return;
			}
			cursor.continue();
		};
	});
}

function transactionCompletion(transaction) {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new Error('The IndexedDB transaction was aborted.'));
		transaction.onerror = () => reject(transaction.error || new Error('The IndexedDB transaction failed.'));
	});
}

function compareStringKeys(left, right) {
	if (left === right) return 0;
	return String(left) < String(right) ? -1 : 1;
}

function deleteByIndex(index, key) {
	return new Promise((resolve, reject) => {
		// IDBKeyCursor cannot mutate records; a value cursor can delete them.
		const cursorRequest = index.openCursor(key);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve();
				return;
			}
			cursor.delete();
			cursor.continue();
		};
	});
}

function getMemoryDatabase(name) {
	if (!memoryDatabases.has(name)) {
		memoryDatabases.set(name, {
			projects: new Map(),
			revisions: new Map(),
			settings: new Map(),
			analysis: new Map(),
			sources: new Map(),
			sourceChunks: new Map(),
			mediaAssets: new Map(),
			videoDerivatives: new Map(),
		});
	}
	return memoryDatabases.get(name);
}

function normalizeBlob(input) {
	if (
		!input
		|| typeof input.size !== 'number'
		|| typeof input.slice !== 'function'
		|| typeof input.arrayBuffer !== 'function'
	) {
		throw new TypeError('A Blob or File is required.');
	}
	return input;
}

function blobWithMimeType(blob, mimeType) {
	const requestedType = String(mimeType || '');
	if (!requestedType || blob.type === requestedType) return blob;
	return blob.slice(0, blob.size, requestedType);
}

function binaryMetadata(metadata) {
	const value = metadata && typeof metadata === 'object' ? clone(metadata) : {};
	for (const key of [
		'key',
		'sourceId',
		'timestamp',
		'type',
		'storage',
		'path',
		'blob',
		'size',
		'mimeType',
		'committedAt',
		'pendingProjectUntil',
	]) delete value[key];
	return value;
}

function mediaAssetMetadata(record) {
	const value = clone(record);
	delete value.blob;
	return value;
}

function videoDerivativeMetadata(record) {
	const value = clone(record);
	delete value.blob;
	return value;
}

function videoDerivativeIdentity(sourceId, timestamp, type) {
	const id = nonEmptyString(sourceId, 'A media source id is required.');
	const derivativeType = nonEmptyString(type, 'A video derivative type is required.');
	const sourceTimestamp = nonNegativeFiniteNumber(timestamp, 'A non-negative derivative timestamp is required.');
	return {
		key: JSON.stringify([id, derivativeType, sourceTimestamp]),
		sourceId: id,
		timestamp: sourceTimestamp,
		type: derivativeType,
	};
}

function sourceStorageCandidates(sources, mediaAssets, videoDerivatives) {
	const candidates = new Map();
	const candidateFor = (sourceId) => {
		if (!candidates.has(sourceId)) {
			candidates.set(sourceId, { source: null, mediaAsset: null, derivatives: [] });
		}
		return candidates.get(sourceId);
	};
	for (const source of sources || []) {
		if (source?.id) candidateFor(source.id).source = source;
	}
	for (const mediaAsset of mediaAssets || []) {
		if (mediaAsset?.sourceId) candidateFor(mediaAsset.sourceId).mediaAsset = mediaAsset;
	}
	for (const derivative of videoDerivatives || []) {
		if (derivative?.sourceId) candidateFor(derivative.sourceId).derivatives.push(derivative);
	}
	return candidates;
}

function candidateEligibleAt(candidate, minimumAgeMs) {
	return Math.max(
		candidate?.source ? sourceEligibleAt(candidate.source, minimumAgeMs) : 0,
		candidate?.mediaAsset ? sourceEligibleAt(candidate.mediaAsset, minimumAgeMs) : 0,
		...(candidate?.derivatives || []).map((record) => sourceEligibleAt(record, minimumAgeMs)),
	);
}

function normalizeChannels(input) {
	if (!input || typeof input.length !== 'number') return [];
	return Array.from(input, (channel) => channel instanceof Float32Array ? channel : Float32Array.from(channel || []));
}

function protectSourceDependencies(protectedIds, sources) {
	const byId = new Map((sources || []).map((source) => [source.id, source]));
	const pending = [...protectedIds];
	while (pending.length) {
		const source = byId.get(pending.pop());
		if (!source?.baseSourceId || protectedIds.has(source.baseSourceId)) continue;
		protectedIds.add(source.baseSourceId);
		pending.push(source.baseSourceId);
	}
	return protectedIds;
}

function sourceEligibleAt(source, minimumAgeMs) {
	const committedAt = Date.parse(source?.committedAt || '');
	const pendingProjectUntil = Date.parse(source?.pendingProjectUntil || '');
	return Math.max(
		Number.isFinite(committedAt) ? committedAt + minimumAgeMs : 0,
		Number.isFinite(pendingProjectUntil) ? pendingProjectUntil : 0,
	);
}

function publishSource(source) {
	const { pendingProjectUntil: _pendingProjectUntil, ...published } = source;
	return published;
}

function cloneChunk(record) {
	const copy = { ...record };
	if (Array.isArray(record.channels)) {
		copy.channels = record.channels.map((buffer) => buffer.slice(0));
	}
	if (record.payload instanceof ArrayBuffer) copy.payload = record.payload.slice(0);
	else if (ArrayBuffer.isView(record.payload)) {
		copy.payload = record.payload.buffer.slice(
			record.payload.byteOffset,
			record.payload.byteOffset + record.payload.byteLength,
		);
	}
	return copy;
}

function sourceChunkFromLegacyRecord(record) {
	if (!Array.isArray(record?.channels) || !record.channels.length) {
		throw new PcmStorageCorruptionError(
			'Legacy PCM record has no planar channels.',
			'PCM_RECORD_GEOMETRY',
		);
	}
	const frames = Number(record.frames);
	const index = Number(record.index);
	let channelBytes;
	try {
		channelBytes = pcmRawByteLength(frames, record.channels.length) / record.channels.length;
		if (!Number.isSafeInteger(index) || index < 0) {
			throw new RangeError('Legacy PCM chunk index is invalid.');
		}
	} catch (error) {
		throw new PcmStorageCorruptionError(
			'Legacy PCM record has invalid geometry.',
			'PCM_RECORD_GEOMETRY',
			{ cause: error },
		);
	}
	const channels = record.channels.map((input) => {
		let buffer;
		try {
			buffer = exactArrayBuffer(input);
		} catch (error) {
			throw new PcmStorageCorruptionError(
				'Legacy PCM channel payload is invalid.',
				'PCM_RECORD_GEOMETRY',
				{ cause: error },
			);
		}
		if (buffer.byteLength !== channelBytes) {
			throw new PcmStorageCorruptionError(
				'Legacy PCM channel payload does not match its declared frame count.',
				'PCM_RECORD_GEOMETRY',
			);
		}
		return new Float32Array(buffer.slice(0));
	});
	return {
		index,
		frames,
		channels,
	};
}

function isOpfsPcmStorage(storage) {
	return storage === 'opfs' || storage === PCM_CONTAINER_STORAGE_TYPE;
}

function sourceNeedsLegacyPcmMigration(source) {
	if (!source) return false;
	if (source.storage === 'opfs') return true;
	return (source.storage === 'indexeddb-chunks' || source.storage === 'copy-on-write')
		&& source.pcmEncodingVersion !== 1;
}

function sameStoredSourceIdentity(left, right) {
	return Boolean(left && right
		&& left.id === right.id
		&& left.storage === right.storage
		&& (left.sourceToken || null) === (right.sourceToken || null)
		&& (left.path || null) === (right.path || null)
		&& (left.baseSourceId || null) === (right.baseSourceId || null)
		&& (left.pcmEncodingVersion ?? null) === (right.pcmEncodingVersion ?? null));
}

async function yieldMigration(signal) {
	throwIfAborted(signal);
	await new Promise((resolve) => setTimeout(resolve, 0));
	throwIfAborted(signal);
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	const error = new Error('Audio source loading was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function revisionKey(projectId, revision) {
	return `${projectId}:${String(nonNegativeInteger(revision, 0)).padStart(12, '0')}`;
}

function createId(prefix) {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nonNegativeInteger(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function nonNegativeFiniteNumber(value, message) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(message);
	return number;
}

function nonEmptyString(value, message) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(message);
	return text;
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizePcmChunkFrames(value) {
	const frames = Number(value);
	if (!Number.isSafeInteger(frames)
		|| frames < 1
		|| frames > WAVPACK_PCM_MAXIMUM_FRAMES) {
		throw new RangeError(`PCM chunk size must be an integer between 1 and ${WAVPACK_PCM_MAXIMUM_FRAMES} frames.`);
	}
	return frames;
}

function sortProjects(left, right) {
	return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}
