import {
	TextReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createStableId } from './project.js';
import { migrateAudioEditorProject } from './migration.js';
import { aggregateScapeErrors, awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import {
	readScapeArchiveEnvelope,
	SCAPE_FORMAT,
	SCAPE_FORMAT_VERSION,
	SCAPE_MANIFEST_ENTRY,
	SCAPE_PROJECT_ENTRY,
	SCAPE_ARCHIVE_LIMITS,
} from './scape-archive-envelope.ts';
import { ScapeAudioChunkBudget } from './scape-expanded-byte-budget.ts';
import {
	createScapeDigest,
	createScapeAudioExportChunkBudget,
	digestScapeBytes,
	extractScapeAudio,
	extractScapeBlob,
	safeScapeEntryId,
	scapeAudioSourceStream,
	scapeBytesStream,
	scapeHashingStream,
	scapeHex,
	verifyScapeAssetBytes,
	verifyScapeExtractedAsset,
} from './scape-archive-media.ts';
import { withScapeArchiveReader } from './scape-archive-reader.ts';
import { createScapeExportDestination } from './scape-export-destination.ts';
import {
	assertScapeImportStore,
	ScapeImportTransaction,
} from './scape-import-transaction.ts';

export { SCAPE_FORMAT, SCAPE_FORMAT_VERSION };
export const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
export const SCAPE_FILE_EXTENSION = '.scape';

const PROJECT_ENTRY = SCAPE_PROJECT_ENTRY;
const MANIFEST_ENTRY = SCAPE_MANIFEST_ENTRY;
const AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const TEXT_ENCODER = new TextEncoder();

export async function exportScapeProject(project, store, options = {}) {
	if (!project || typeof project !== 'object') throw new TypeError('A project is required.');
	if (!store?.readSourceChunks || !store?.loadMediaAsset) throw new TypeError('A project store is required.');
	const sources = project.sources || [];
	if (sources.length + 2 > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
		throw new RangeError('The project has too many sources for the portable archive.');
	}
	const audioChunkBudget = createScapeAudioExportChunkBudget(sources);
	const signal = options.signal;
	throwIfScapeAborted(signal);
	const destination = createScapeExportDestination(options.writable, SCAPE_MIME_TYPE);
	const writer = new ZipWriter(destination.target, {
		zip64: true,
		level: 0,
		useWebWorkers: false,
		signal,
	});
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const projectDigest = digestScapeBytes(projectBytes);
	const assets = [];

	try {
		await awaitScapeOperation(writer.add(PROJECT_ENTRY, scapeBytesStream(projectBytes), {
			level: 0,
			zip64: true,
			signal,
		}), signal);
		for (const source of sources) {
			throwIfScapeAborted(signal);
			const entry = source.kind === 'video'
				? `media/${safeScapeEntryId(source.id)}/original`
				: `audio/${safeScapeEntryId(source.id)}.f32c`;
			const digest = createScapeDigest();
			let size = 0;
			if (source.kind === 'video') {
				const blob = await awaitScapeOperation(store.loadMediaAsset(source.storageKey || source.id), signal);
				if (!blob) throw new Error(`Media source ${source.name || source.id} is unavailable.`);
				size = blob.size;
				await awaitScapeOperation(writer.add(
					entry,
					scapeHashingStream(blob.stream(), digest, signal),
					{ level: 0, zip64: true, signal },
				), signal);
			} else {
				const stream = scapeAudioSourceStream(
					store,
					source,
					digest,
					(byteLength) => { size += byteLength; },
					signal,
					audioChunkBudget,
				);
				await awaitScapeOperation(writer.add(entry, stream, { level: 0, zip64: true, signal }), signal);
			}
			assets.push({
				sourceId: source.id,
				kind: source.kind === 'video' ? 'video' : 'audio',
				entry,
				encoding: source.kind === 'video' ? 'original' : AUDIO_ENCODING,
				mimeType: String(source.mimeType || ''),
				size,
				sha256: scapeHex(digest.digest()),
			});
		}
		const manifest = {
			format: SCAPE_FORMAT,
			formatVersion: SCAPE_FORMAT_VERSION,
			createdAt: new Date().toISOString(),
			project: {
				entry: PROJECT_ENTRY,
				mimeType: 'application/json',
				schemaVersion: project.schemaVersion,
				size: projectBytes.byteLength,
				sha256: projectDigest,
			},
			assets,
		};
		throwIfScapeAborted(signal);
		await awaitScapeOperation(writer.add(MANIFEST_ENTRY, new TextReader(JSON.stringify(manifest)), {
			level: 0,
			zip64: true,
			signal,
		}), signal);
		const blob = await destination.finish(writer, signal);
		return { blob, manifest };
	} catch (error) {
		return destination.abort(writer, error);
	}
}

export async function importScapeProject(input, store, options = {}) {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	const signal = options.signal;
	let transaction = null;
	try {
		const result = await withScapeArchiveReader(input, signal, async (entries) => {
			const {
				entryByName,
				expandedByteBudget,
				manifest,
				projectText,
			} = await readScapeArchiveEnvelope(entries, options.archiveLimits || {}, signal);
			assertScapeImportStore(store);
			transaction = new ScapeImportTransaction(store, signal);
			const audioChunkBudget = new ScapeAudioChunkBudget();
			const projectBytes = TEXT_ENCODER.encode(projectText);
			verifyScapeAssetBytes(projectBytes, manifest.project, 'project document');
			throwIfScapeAborted(signal);
			const loaded = migrateAudioEditorProject(JSON.parse(projectText));
			let project = structuredClone(loaded.project);
			const existingProject = await awaitScapeOperation(store.loadProject(project.id), signal);
			const collision = options.collision || 'copy';
			if (existingProject && collision === 'cancel') throw new Error('A project with this ID already exists.');
			if (existingProject && collision === 'copy') {
				project.id = createStableId('project');
				project.title = `${project.title || 'Untitled'} copy`;
				project.revision = 0;
				project.createdAt = new Date().toISOString();
				project.updatedAt = project.createdAt;
			}
			await transaction.captureProject(project.id);

			const assetBySourceId = new Map(manifest.assets.map((asset) => [asset.sourceId, asset]));
			if (assetBySourceId.size !== manifest.assets.length) throw new Error('The .scape manifest contains duplicate source assets.');
			const sourceIdMap = new Map();
			for (const source of project.sources || []) {
				throwIfScapeAborted(signal);
				const asset = assetBySourceId.get(source.id);
				if (!asset) throw new Error(`The .scape archive is missing source ${source.id}.`);
				if ((source.kind === 'video' ? 'video' : 'audio') !== asset.kind) {
					throw new Error(`Source ${source.id} has an incompatible asset kind.`);
				}
				const occupied = source.kind === 'video'
					? await awaitScapeOperation(store.getMediaAssetMetadata(source.storageKey || source.id), signal)
					: await awaitScapeOperation(store.getSourceMetadata(source.storageKey || source.id), signal);
				const nextId = occupied ? createStableId(source.kind === 'video' ? 'video-source' : 'source') : source.id;
				sourceIdMap.set(source.id, nextId);
				source.id = nextId;
				source.storageKey = nextId;
			}
			for (const clip of [...(project.clips || []), ...(project.projectBin?.clips || [])]) {
				clip.sourceId = sourceIdMap.get(clip.sourceId) || clip.sourceId;
			}

			for (const [originalSourceId, finalSourceId] of sourceIdMap) {
				throwIfScapeAborted(signal);
				const source = project.sources.find((candidate) => candidate.id === finalSourceId);
				const asset = assetBySourceId.get(originalSourceId);
				const entry = entryByName.get(asset.entry);
				if (!entry) throw new Error(`The .scape archive is missing ${asset.entry}.`);
				transaction.trackProvisionalSource(finalSourceId);
				if (source.kind === 'video') {
					const { blob, digest, size } = await extractScapeBlob(
						entry,
						source.mimeType,
						signal,
						expandedByteBudget,
					);
					verifyScapeExtractedAsset(asset, digest, size, source.name || source.id);
					await awaitScapeOperation(store.writeMediaAsset(finalSourceId, blob, {
						name: source.name,
						mimeType: source.mimeType,
					}), signal);
				} else {
					if (asset.encoding !== AUDIO_ENCODING) throw new Error(`Unsupported audio asset encoding: ${asset.encoding}.`);
					throwIfScapeAborted(signal);
					const sourceWriter = await store.beginSourceWrite(finalSourceId, {
						name: source.name,
						mimeType: source.mimeType,
						sampleRate: source.sampleRate,
						channelCount: source.channelCount,
						chunkFrames: source.chunkFrames,
					});
					try {
						throwIfScapeAborted(signal);
						const extracted = await extractScapeAudio(
							entry,
							sourceWriter,
							source,
							signal,
							expandedByteBudget,
							audioChunkBudget,
						);
						verifyScapeExtractedAsset(asset, extracted.digest, extracted.size, source.name || source.id);
						await awaitScapeOperation(sourceWriter.commit({
							sampleRate: source.sampleRate,
							channelCount: source.channelCount,
						}, { signal }), signal);
					} catch (error) {
						try {
							await sourceWriter.abort();
						} catch (abortError) {
							throw aggregateScapeErrors(error, [abortError], 'The .scape source write and cleanup both failed.');
						}
						throw error;
					}
				}
			}
			await transaction.publishProject(project);
			return {
				project,
				manifest,
				readOnly: loaded.readOnly,
				reason: loaded.reason,
				collision: existingProject ? collision : null,
			};
		}, options.archiveReaderFactory);
		transaction.complete();
		return result;
	} catch (error) {
		if (transaction) return transaction.rollback(error);
		throw error;
	}
}

/**
 * @param {Blob} input
 * @param {{ loadProject?: (projectId: string) => PromiseLike<unknown> } | null} store
 * @param {{ signal?: AbortSignal }} options
 */
export async function inspectScapeProject(input, store = null, options = {}) {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	const signal = options.signal;
	return withScapeArchiveReader(input, signal, async (entries) => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(
			entries,
			options.archiveLimits || {},
			signal,
		);
		verifyScapeAssetBytes(TEXT_ENCODER.encode(projectText), manifest.project, 'project document');
		throwIfScapeAborted(signal);
		const loaded = migrateAudioEditorProject(JSON.parse(projectText));
		const existing = store?.loadProject
			? await awaitScapeOperation(store.loadProject(loaded.project.id), signal)
			: null;
		return Object.freeze({
			id: loaded.project.id,
			title: loaded.project.title,
			schemaVersion: loaded.project.schemaVersion,
			readOnly: loaded.readOnly,
			exists: Boolean(existing),
			manifest,
		});
	}, options.archiveReaderFactory);
}
